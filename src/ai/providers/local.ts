import type { CoachProposal, TacticalPlanInput, TrainingPlanInput } from '@/domain/schemas';
import { coachProposalSchema } from '@/domain/schemas';
import { getFormation } from '@/domain/tactics/formations';
import { autoSelectLineup, defaultSubstitutionPlan, slotScore, type SelectablePlayer } from '@/domain/tactics/selection';
import type { Formation } from '@/domain/types';
import type { CoachContext } from '../context';
import type { AiProvider, CoachRequest, CoachResult } from '../provider';

/**
 * The local coach.
 *
 * A deterministic, rule-based assistant that reads the manager's instruction,
 * the squad and the public opponent profile, and returns a fully structured
 * proposal. It exists for three reasons: the game must be completely playable
 * with no provider account, it is the fallback when a provider fails, and it
 * makes the AI workflow testable without a network call.
 *
 * It is an assistant, not a decision-maker: like any provider it returns a
 * proposal that the domain validates and the human approves.
 */

interface Intent {
  possession: boolean;
  direct: boolean;
  counter: boolean;
  pressHigh: boolean;
  sitDeep: boolean;
  protectMidfield: boolean;
  useWidth: boolean;
  usePace: boolean;
  cautiousStart: boolean;
  chaseIfBehind: boolean;
  avoidTransitionRisk: boolean;
  patient: boolean;
  playAroundPress: boolean;
  setPieces: boolean;
  rotate: boolean;
  vague: boolean;
}

const PATTERNS: Array<[keyof Intent, RegExp]> = [
  ['possession', /possess|keep the ball|dominate the ball|control the (game|ball)|on the ball/i],
  ['direct', /direct|long ball|get it forward|go long|bypass/i],
  ['counter', /counter|on the break|hit them|space behind|transition(s)? (quickly|fast)/i],
  ['pressHigh', /press(ing|ure)?\b|win it back|high line|aggressive(ly)?|suffocate/i],
  ['sitDeep', /sit (back|deep|off)|low block|absorb|deep(er)? line|contain|see out/i],
  ['protectMidfield', /midfield|centre of the pitch|central areas|overrun|outnumber/i],
  ['useWidth', /wing|wide|flank|full-?back|cross(es|ing)?|stretch/i],
  ['usePace', /pace|quick|rapid|speed|behind (their|the)/i],
  ['cautiousStart', /start caut|start slow|cagey|begin caut|first (twenty|20|thirty|30)/i],
  ['chaseIfBehind', /if (we('| a)?re )?behind|chase the game|more attacking if|if we go (a goal )?down/i],
  ['avoidTransitionRisk', /exposed in transition|caught on the counter|counter-?attack against|leave (us|ourselves) open/i],
  ['patient', /patient|slowly|build up slow|take our time|no rush/i],
  ['playAroundPress', /around them|play around|beat the press|through the press|they press/i],
  ['setPieces', /set(-| )piece|corner|free kick|dead ball/i],
  ['rotate', /rotate|rest|freshen|rotation|tired/i],
];

/**
 * Clauses describing the opposition are not instructions. "They press
 * aggressively" is a fact about the opponent, not a request to press, so those
 * clauses are removed before intent is read.
 */
const OPPONENT_CLAUSE = /\b(they|their|theirs|the opposition|the opponents?)\b[^,.;!?]*/gi;

function readIntent(message: string): Intent {
  const intent = {
    possession: false, direct: false, counter: false, pressHigh: false, sitDeep: false,
    protectMidfield: false, useWidth: false, usePace: false, cautiousStart: false,
    chaseIfBehind: false, avoidTransitionRisk: false, patient: false,
    playAroundPress: false, setPieces: false, rotate: false, vague: false,
  } as Intent;
  const ourIntentText = message.replace(OPPONENT_CLAUSE, ' ');
  for (const [key, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    // playAroundPress is deliberately read from the full message: it is a
    // response to something the opponent does.
    const haystack = key === 'playAroundPress' ? message : ourIntentText;
    if (pattern.test(haystack)) (intent[key] as boolean) = true;
  }
  const signals = Object.values(intent).filter(Boolean).length;
  intent.vague = signals === 0 || message.trim().length < 12;
  return intent;
}

/** Which shape the available players actually suit best. */
function bestAvailableFormation(squad: SelectablePlayer[], candidates: Formation[]): Formation {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const formation of candidates) {
    const lineup = autoSelectLineup(squad, formation);
    if (lineup.starters.length < 11) continue;
    const score = lineup.starters.reduce(
      (acc, entry) => acc + slotScore(
        squad.find((p) => p.id === entry.playerId)!, formation, entry.slot), 0);
    if (score > bestScore) { bestScore = score; best = formation; }
  }
  return best;
}

function toSelectable(context: CoachContext): SelectablePlayer[] {
  // The coach only ever sees its own squad, so this is the manager's own data.
  return context.squad.map((p) => ({
    id: p.id,
    name: p.name,
    primaryPosition: p.position,
    secondaryPositions: p.secondaryPositions,
    // Attribute detail is summarised in context; approximate from the headline.
    attributes: approximateAttributes(p.overall, p.position === 'GK'),
    fitness: p.fitness,
    form: p.form,
    injured: !p.available && p.status.startsWith('injured'),
    suspended: !p.available && p.status.startsWith('suspended'),
  }));
}

function approximateAttributes(overall: number, isKeeper: boolean) {
  const base = Math.max(1, Math.min(99, overall));
  const attributes: Record<string, number> = {};
  const keys = [
    'passing', 'firstTouch', 'dribbling', 'finishing', 'crossing', 'tackling', 'marking',
    'heading', 'longShots', 'setPieces', 'decisions', 'positioning', 'composure',
    'concentration', 'anticipation', 'workRate', 'teamwork', 'vision', 'determination',
    'pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance',
    'handling', 'reflexes', 'oneOnOnes', 'distribution',
  ];
  const keeperKeys = new Set(['handling', 'reflexes', 'oneOnOnes', 'distribution']);
  for (const key of keys) {
    attributes[key] = isKeeper
      ? (keeperKeys.has(key) ? base : Math.max(8, base - 24))
      : (keeperKeys.has(key) ? 12 : base);
  }
  return attributes as never;
}

export function proposeLocally(request: CoachRequest): CoachProposal {
  const { context } = request;
  const intent = readIntent(request.message);
  const plan: TacticalPlanInput = { ...context.currentPlan };
  const reasons: string[] = [];
  const risks: string[] = [];
  const questions: string[] = [];

  // --- Read the opponent (public information only) -------------------------
  const opponentNotes = new Map<string, string>();
  for (const observation of context.opponent?.observations ?? []) {
    opponentNotes.set(observation.label, observation.estimate);
  }
  const opponentPresses = (opponentNotes.get('Pressing') ?? '').includes('aggressively');
  const opponentHoldsBall = (opponentNotes.get('Possession') ?? '').includes('dominate');
  const opponentGoesLong = (opponentNotes.get('Directness') ?? '').includes('long');
  const opponentOpenInTransition = opponentNotes.has('Transition defence');

  // --- Style ---------------------------------------------------------------
  if (intent.possession || intent.patient) {
    plan.playingStyle = intent.patient ? 'PATIENT_BUILD_UP' : 'POSSESSION';
    plan.buildUp = 'SHORT_PASSING';
    plan.tempo = intent.patient ? 'SLOW' : 'NORMAL';
    reasons.push('You asked for control of the ball, so the side builds short and keeps the tempo measured.');
  } else if (intent.counter) {
    plan.playingStyle = 'COUNTER_ATTACKING';
    plan.counterAttack = true;
    plan.buildUp = 'MIXED';
    reasons.push('Counter-attacking is set as the primary route to goal, with players told to break at pace on turnovers.');
  } else if (intent.direct) {
    plan.playingStyle = 'DIRECT';
    plan.buildUp = 'DIRECT';
    reasons.push('Build-up goes direct, getting the ball forward early rather than working it through the lines.');
  }

  if (intent.playAroundPress || opponentPresses) {
    // Playing through a heavy press with short passing is how goals get given away.
    if (plan.buildUp === 'SHORT_PASSING') plan.buildUp = 'MIXED';
    plan.riskTolerance = 'MEASURED';
    reasons.push(opponentPresses
      ? `${context.fixture?.opponentName ?? 'The opposition'} press aggressively, so build-up is mixed rather than forcing short passes into pressure.`
      : 'Build-up is mixed so the first pass can go around the press rather than into it.');
  }

  // --- Pressing and defensive shape ---------------------------------------
  if (intent.pressHigh) {
    plan.pressing = context.familiarity.pressing >= 55 ? 'INTENSE' : 'HIGH';
    plan.defensiveApproach = 'AGGRESSIVE_PRESSING';
    plan.defensiveLine = 'HIGH';
    plan.counterPress = true;
    reasons.push('The press is raised and counter-pressing switched on to win the ball back high.');
    risks.push('A high press leaves space in behind. If they beat the first line you will be exposed one on one.');
  } else if (intent.sitDeep) {
    plan.pressing = 'LOW';
    plan.defensiveApproach = 'LOW_BLOCK';
    plan.defensiveLine = 'DEEP';
    plan.mentality = 'DEFENSIVE';
    plan.counterAttack = true;
    reasons.push('The side drops into a low block and looks to break rather than chase the ball.');
    risks.push('Sitting deep invites sustained pressure and concedes territory. Expect to defend your box.');
  } else if (opponentHoldsBall) {
    plan.defensiveApproach = 'MID_BLOCK';
    plan.pressing = 'MEDIUM';
    reasons.push(`${context.fixture?.opponentName ?? 'They'} want the ball, so a mid-block concedes it in harmless areas and stays compact.`);
  }

  if (intent.avoidTransitionRisk) {
    plan.fullBackFreedom = Math.min(plan.fullBackFreedom, 40);
    plan.counterPress = true;
    plan.riskTolerance = plan.riskTolerance === 'RECKLESS' ? 'BALANCED' : plan.riskTolerance;
    if (plan.defensiveLine === 'VERY_HIGH') plan.defensiveLine = 'HIGH';
    reasons.push('Full-backs are held back and counter-pressing is on, specifically to close the transition risk you flagged.');
  }

  // --- Shape ---------------------------------------------------------------
  const squad = toSelectable(context);
  if (intent.protectMidfield) {
    const candidates: Formation[] = ['F_4_2_3_1', 'F_3_5_2', 'F_5_3_2'];
    const preferred = candidates
      .map((f) => ({ f, familiarity: context.availableFormations.find((a) => a.formation === f)?.familiarity ?? 30 }))
      .sort((a, b) => b.familiarity - a.familiarity)[0];
    plan.formation = preferred.f;
    plan.width = 'NARROW';
    reasons.push(`A ${getFormation(plan.formation).label} puts an extra body in central midfield, which is what you asked for. It is the most rehearsed of the options at ${preferred.familiarity}%.`);
  } else if (intent.useWidth || intent.usePace) {
    const candidates: Formation[] = ['F_4_3_3', 'F_4_4_2', 'F_4_2_3_1'];
    plan.formation = bestAvailableFormation(squad, candidates);
    plan.width = 'WIDE';
    plan.attackingFocus = 'BOTH_FLANKS';
    plan.fullBackFreedom = Math.max(plan.fullBackFreedom, 62);
    reasons.push(`A ${getFormation(plan.formation).label} with maximum width gets your wide players isolated against their full-backs.`);
  }

  if (intent.usePace) {
    plan.counterAttack = true;
    reasons.push('Attackers are told to run the channels and attack the space behind rather than come short.');
  }

  // --- Mentality and match-state instructions ------------------------------
  if (intent.cautiousStart) {
    plan.mentality = 'DEFENSIVE';
    plan.matchStateInstructions = [
      { trigger: 'AFTER_60', adjustment: 'MORE_ATTACKING', fromMinute: 60, note: 'Open up once the game has settled.' },
      { trigger: 'TRAILING', adjustment: 'MORE_ATTACKING', fromMinute: 55, note: 'Chase the game if behind.' },
    ];
    reasons.push('The side starts cautiously and is instructed to become more attacking after the hour, or sooner if behind.');
  } else if (intent.chaseIfBehind) {
    plan.matchStateInstructions = [
      { trigger: 'TRAILING', adjustment: 'MORE_ATTACKING', fromMinute: 55, note: 'Chase the game if behind.' },
    ];
    reasons.push('A trigger is set so the team pushes on if you fall behind.');
  }
  if (!intent.cautiousStart && plan.matchStateInstructions.length === 0) {
    plan.matchStateInstructions = [
      { trigger: 'LEADING', adjustment: 'MORE_DEFENSIVE', fromMinute: 75, note: 'Protect a lead late on.' },
    ];
  }

  if (intent.setPieces) {
    plan.setPieceApproach = 'DIRECT_DELIVERY';
    reasons.push('Set pieces are set to direct delivery to make the most of your aerial presence.');
  }

  // --- Line-up -------------------------------------------------------------
  const available = squad.filter((p) => !p.injured && !p.suspended);
  const lineup = autoSelectLineup(available, plan.formation);
  if (intent.rotate) {
    reasons.push('Selection leans on the freshest legs available given the fitness levels in the squad.');
  }
  plan.substitutionPlan = defaultSubstitutionPlan(lineup, available, plan.formation);

  // --- Familiarity honesty -------------------------------------------------
  const targetFamiliarity = context.availableFormations
    .find((f) => f.formation === plan.formation)?.familiarity ?? 30;
  if (targetFamiliarity < 45) {
    risks.push(`The squad has only trained ${getFormation(plan.formation).label} to ${targetFamiliarity}%. Shape and positioning will be loose until that improves.`);
  }
  if ((plan.pressing === 'HIGH' || plan.pressing === 'INTENSE') && context.familiarity.pressing < 50) {
    risks.push(`Pressing familiarity is ${context.familiarity.pressing}%. The press will be mistimed and playable through until it is drilled.`);
  }
  if (plan.buildUp === 'SHORT_PASSING' && context.familiarity.buildUp < 50) {
    risks.push(`Build-up familiarity is ${context.familiarity.buildUp}%. Short passing out from the back will cost you the ball in bad areas.`);
  }
  if (opponentOpenInTransition && !plan.counterAttack) {
    reasons.push(`${context.fixture?.opponentName ?? 'They'} have been opened up on the counter this season; there is an argument for switching counter-attacking on.`);
  }
  if (opponentGoesLong) {
    reasons.push('They go long early, so the centre-backs will need to win first contact and the midfield must pick up second balls.');
  }

  // --- Training ------------------------------------------------------------
  const training = recommendTraining(context, plan);

  // --- Questions -----------------------------------------------------------
  if (intent.vague) {
    questions.push('What outcome matters most this week: a solid point, or going for the win?');
    questions.push('Is there a player or an area of their side you specifically want to target?');
  }
  if (intent.pressHigh && intent.sitDeep) {
    questions.push('You have asked to press high and to sit deep. Which should the side default to, and when should it switch?');
  }

  const tiredPlayers = context.squad.filter((p) => p.available && p.fitness < 70).length;
  if (tiredPlayers >= 4) {
    risks.push(`${tiredPlayers} available players are below 70% fitness. Expect the side to fade in the last twenty minutes.`);
  }

  const headline = intent.vague
    ? `Here is a plan that keeps continuity with what the side already knows. Tell me more about how you want to play and I will reshape it.`
    : `Here is how I would set us up for ${context.fixture?.opponentName ?? 'the next match'}.`;

  const message = [
    headline,
    `${getFormation(plan.formation).label}, ${plan.mentality.replace(/_/g, ' ').toLowerCase()} mentality, ${plan.playingStyle.replace(/_/g, ' ').toLowerCase()}, ${plan.pressing.toLowerCase()} pressing behind a ${plan.defensiveLine.replace(/_/g, ' ').toLowerCase()} line.`,
    reasons.length > 0 ? reasons.join(' ') : '',
  ].filter(Boolean).join('\n\n');

  return coachProposalSchema.parse({
    message,
    rationale: reasons.join(' '),
    risks,
    clarifyingQuestions: questions,
    tactics: plan,
    lineup,
    training,
  });
}

function recommendTraining(context: CoachContext, plan: TacticalPlanInput): TrainingPlanInput {
  const gaps: Array<{ focus: TrainingPlanInput['primaryFocus']; value: number }> = [
    { focus: 'FORMATION_FAMILIARITY', value: context.availableFormations.find((f) => f.formation === plan.formation)?.familiarity ?? 30 },
    { focus: 'PRESSING', value: context.familiarity.pressing },
    { focus: 'DEFENSIVE_ORGANISATION', value: context.familiarity.defensiveOrganisation },
    { focus: 'POSSESSION', value: context.familiarity.buildUp },
    { focus: 'TRANSITION_PLAY', value: context.familiarity.transition },
    { focus: 'SET_PIECES', value: context.familiarity.setPieces },
  ];
  // Only rehearse what this week's plan actually needs.
  const relevant = gaps.filter((g) => {
    if (g.focus === 'PRESSING') return plan.pressing === 'HIGH' || plan.pressing === 'INTENSE';
    if (g.focus === 'POSSESSION') return plan.buildUp === 'SHORT_PASSING' || plan.playingStyle === 'POSSESSION';
    if (g.focus === 'TRANSITION_PLAY') return plan.counterAttack || plan.playingStyle === 'COUNTER_ATTACKING';
    return true;
  });

  const weakest = relevant.sort((a, b) => a.value - b.value)[0];
  const averageFitness = context.squad.filter((p) => p.available)
    .reduce((acc, p) => acc + p.fitness, 0) / Math.max(1, context.squad.filter((p) => p.available).length);

  const primary = weakest?.focus ?? 'MATCH_PREPARATION';
  const secondary: TrainingPlanInput['secondaryFocus'] = averageFitness < 78 ? 'RECOVERY' : 'MATCH_PREPARATION';
  const intensity: TrainingPlanInput['intensity'] = averageFitness < 72 ? 'LIGHT'
    : averageFitness < 84 ? 'NORMAL' : 'HIGH';

  return {
    primaryFocus: primary,
    secondaryFocus: primary === secondary ? 'RECOVERY' : secondary,
    intensity,
    targetFormation: primary === 'FORMATION_FAMILIARITY' ? plan.formation : null,
    individualFocus: [],
    notes: `Weakest relevant area is ${primary.replace(/_/g, ' ').toLowerCase()} at ${Math.round(weakest?.value ?? 0)}%. Squad fitness averages ${Math.round(averageFitness)}%.`,
  };
}

export class LocalCoachProvider implements AiProvider {
  readonly name = 'local';
  readonly model = 'heuristic-coach-1';

  async propose(request: CoachRequest): Promise<CoachResult> {
    const started = Date.now();
    const proposal = proposeLocally(request);
    return {
      proposal,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      fallbackUsed: false,
      warnings: [],
    };
  }
}
