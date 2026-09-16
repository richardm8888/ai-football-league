/**
 * Measure what a coaching request costs.
 *
 * Every number in docs/AI_COSTS.md comes from this script, so the document can
 * be re-checked rather than trusted. It imports the same assembly functions the
 * Anthropic provider uses, which is the point: a reconstruction of the prompt
 * would drift from the real one the first time either changed.
 *
 * Conversation history and staff notes are produced by driving the real askCoach
 * path with the local provider rather than invented here, because both are
 * written by the app and both grow with use.
 *
 * Character counts are exact. Token counts come from the count_tokens endpoint
 * when ANTHROPIC_API_KEY is set, and from the legacy Anthropic BPE otherwise,
 * because the tokeniser for current models cannot be run offline. The report
 * says which one it used.
 *
 *   npm run pg:start
 *   DATABASE_URL=postgresql://aifl:aifl@127.0.0.1:5433/aifl npm run db:deploy
 *   SEED_MATCHDAYS=7 DATABASE_URL=... npm run db:seed
 *   DATABASE_URL=... AI_PROVIDER=local npx tsx scripts/ai-cost.ts
 */

import { countTokens } from '@anthropic-ai/tokenizer';
import { prisma } from '../src/lib/db';
import { askCoach } from '../src/ai/coach';
import { buildCoachContext, type CoachContext } from '../src/ai/context';
import { COACH_SYSTEM_PROMPT, PROPOSE_PLAN_TOOL } from '../src/ai/prompt';
import { proposeLocally } from '../src/ai/providers/local';
import { clean, dataBlock } from '../src/ai/sanitize';

/** Per million tokens, from the Anthropic pricing page. Update both together. */
const PRICES = {
  'claude-opus-5': { input: 5.00, output: 25.00 },
  'claude-sonnet-5': { input: 2.00, output: 10.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
} as const;
const PRICED_AT = '2026-06-24';

/** Cache reads bill at a tenth of input; a five-minute write bills at 1.25x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Sending any tool makes the API prepend its own tool-use system prompt, which
 * is billed but appears nowhere in what we assemble, so it has to be added by
 * hand. The count is per model and depends on tool_choice; these are the
 * published figures for a forced choice, which is what the provider uses.
 * Check the pricing page's tool-use table when changing model.
 */
const TOOL_USE_SYSTEM_PROMPT_TOKENS = {
  'claude-opus-5': 406,
  'claude-sonnet-5': 474,
  'claude-haiku-4-5': 588,
} as const;

const MODEL = (process.env.AI_MODEL ?? 'claude-sonnet-5') as keyof typeof PRICES;

/** What a manager actually types, at the length they type it. */
const INSTRUCTIONS = [
  'Press higher this week and get the ball forward quicker, but do not leave the back four exposed.',
  'Who is carrying a knock? I do not want anyone starting below 80 fitness.',
  'Switch us to a back three and train the shape so we are not learning it on matchday.',
  'They sit deep. Go wider, get the full backs forward, and work on set pieces.',
  'Rest the captain, he has played every minute. Give the young striker a start.',
  'We got beaten at home last week and looked slow in midfield. Sort the training out too.',
  'Keep the same side but drop the line and slow the tempo when we are ahead.',
  'I want possession football from now on. Build towards it over the next few weeks.',
];

// ---------------------------------------------------------------- tokenising

/**
 * The offline counter, used when there is no API key.
 *
 * This is the Claude 1/2 BPE: a real tokeniser of the right family but the
 * wrong generation, and the error does not run in a knowable direction. Claude
 * 4.7 and later use a newer tokeniser that produces roughly 30% more tokens for
 * the same text than the 4.6-and-earlier one, so a count taken here can as
 * easily be under as over. Treat it as an order of magnitude and use
 * count_tokens, which is exact, model-specific and free to call, for anything
 * that matters.
 */
const localCount = (text: string) => (text.length ? countTokens(text) : 0);

/**
 * The authoritative counter. count_tokens is model-specific and exact, which is
 * why it is preferred whenever a key is available, even though the whole report
 * can be produced without one.
 */
async function apiCounts(strings: Iterable<string>): Promise<Map<string, number> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const counts = new Map<string, number>();
  for (const text of strings) {
    if (!text.length) { counts.set(text, 0); continue; }
    const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: text }] }),
    });
    if (!response.ok) {
      console.error(`count_tokens ${response.status}: ${await response.text()}`);
      return null;
    }
    counts.set(text, (await response.json() as { input_tokens: number }).input_tokens);
  }
  return counts;
}

/** Every rendering the lever table needs, so token counts resolve in one pass. */
function leverVariants(
  blocks: Blocks[], c: CoachContext, shortIdSquad: unknown, trimmedSquad: unknown,
  withSquad: (squad: unknown) => Blocks[],
): string[] {
  const thinFormations = (bs: Blocks[]) => bs.map((b) => (b.label === 'available_formations'
    ? { ...b, value: (b.value as Array<{ formation: string; familiarity: number }>)
      .map((f) => ({ formation: f.formation, familiarity: f.familiarity })) }
    : b));
  const out: string[] = [dataBlock('formation_reference', JSON.stringify(
    c.availableFormations.map((f) => ({
      formation: f.formation, label: f.label, description: f.description }))))];
  for (const bs of [blocks, withSquad(shortIdSquad), withSquad(trimmedSquad)]) {
    const thin = thinFormations(bs);
    out.push(render(thin.filter((b) => !b.static), false));
    out.push(render(thin.filter((b) => b.static), false));
  }
  return out;
}

// --------------------------------------------------------------- the request

interface Blocks { label: string; value: unknown; static: boolean }

function contextBlocks(c: CoachContext): Blocks[] {
  return [
    { label: 'your_club', static: false, value: {
      name: c.club.name, nickname: c.club.nickname, reputation: c.club.reputation,
      squadMorale: c.club.morale, statedPhilosophy: c.club.philosophy,
      leaguePosition: c.league.position, points: c.league.points, recentForm: c.league.formGuide } },
    { label: 'next_fixture', static: false, value: c.fixture },
    { label: 'squad', static: false, value: c.squad },
    { label: 'tactical_familiarity', static: false, value: c.familiarity },
    { label: 'current_plan', static: false, value: c.currentPlan },
    { label: 'current_training_plan', static: false, value: c.currentTraining },
    { label: 'opponent_scouting_estimates', static: false, value: c.opponent },
    { label: 'our_recent_matches', static: false, value: c.recentMatches },
    { label: 'league_table', static: false, value: c.league.table },
    { label: 'available_formations', static: false, value: c.availableFormations },
    // Never varies by club, matchday or manager: the same bytes on every request.
    { label: 'available_roles', static: true, value: c.availableRoles },
  ];
}

const render = (blocks: Blocks[], pretty: boolean) => blocks
  .map((b) => dataBlock(b.label, JSON.stringify(b.value, null, pretty ? 1 : undefined)))
  .join('\n\n');

async function main() {
  const club = await prisma.club.findFirstOrThrow({
    where: { ownerUserId: { not: null } }, orderBy: { name: 'asc' },
  });
  const userId = club.ownerUserId as string;

  const turns = Number(process.env.HISTORY_TURNS ?? 8);
  for (let i = 0; i < turns; i += 1) {
    await askCoach({ clubId: club.id, userId, message: INSTRUCTIONS[i % INSTRUCTIONS.length] });
  }

  const context = await buildCoachContext(club.id);
  const [historyRows, memories] = await Promise.all([
    prisma.aiMessage.findMany({
      where: { conversation: { clubId: club.id }, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'asc' }, take: 20,
    }),
    prisma.aiMemory.findMany({ where: { clubId: club.id }, orderBy: { importance: 'desc' }, take: 8 }),
  ]);

  const blocks = contextBlocks(context);
  const notes = memories.length > 0
    ? dataBlock('staff_notes_from_previous_weeks',
      memories.map((m) => `- ${clean(m.key, 60)}: ${clean(m.content, 400)}`).join('\n'))
    : '';
  const managerBlock = dataBlock('manager_message', clean(INSTRUCTIONS[0], 4000));
  // The provider keeps the last eight turns, each truncated to 2000 characters.
  const history = historyRows.slice(-8).map((m) => clean(m.content, 2000) || '(empty)').join('\n');

  const proposal = proposeLocally({ message: INSTRUCTIONS[0], history: [], context, memories: [] });
  const outputs = {
    advice: { message: proposal.message, rationale: proposal.rationale, risks: proposal.risks },
    partial: { message: proposal.message, rationale: proposal.rationale, risks: proposal.risks,
      tactics: proposal.tactics, training: proposal.training },
    full: proposal,
  };

  // Every string this report needs a token count for, gathered so the API
  // counter can resolve them all before anything is printed.
  const dynamicPretty = render(blocks, true);
  const dynamicCompact = render(blocks, false);
  const staticBlocks = blocks.filter((b) => b.static);
  const dynamicOnly = blocks.filter((b) => !b.static);
  const shortIdSquad = context.squad.map((p, i) => ({ ...p, id: `p${i + 1}` }));
  const trimmedSquad = context.squad.map((p, i) => ({
    id: `p${i + 1}`, name: p.name, pos: p.position,
    alt: p.secondaryPositions.length ? p.secondaryPositions : undefined,
    age: p.age, ovr: p.overall, fit: p.fitness, form: p.form, mor: p.morale,
    shp: p.sharpness, status: p.status, standout: p.standout,
  }));
  const withSquad = (squad: unknown) => blocks.map((b) => (b.label === 'squad' ? { ...b, value: squad } : b));

  const toolJson = JSON.stringify(PROPOSE_PLAN_TOOL);
  const toolUseSystem = TOOL_USE_SYSTEM_PROMPT_TOKENS[MODEL];

  const strings = new Set<string>([
    COACH_SYSTEM_PROMPT, toolJson, dynamicPretty, dynamicCompact, notes, managerBlock, history,
    render(staticBlocks, false), render(dynamicOnly, false),
    render(withSquad(shortIdSquad), false), render(withSquad(trimmedSquad), false),
    ...blocks.map((b) => dataBlock(b.label, JSON.stringify(b.value, null, 1))),
    ...Object.values(outputs).map((o) => JSON.stringify(o)),
    // The lever variants further down, so a count_tokens run resolves them in
    // the same pass rather than one request at a time as the table prints.
    ...leverVariants(blocks, context, shortIdSquad, trimmedSquad, withSquad),
  ]);

  const measured = await apiCounts(strings);
  const label = measured
    ? `count_tokens against ${MODEL} (exact)`
    : 'legacy Anthropic BPE (indicative only; set ANTHROPIC_API_KEY for exact counts)';
  const counts = measured ?? new Map([...strings].map((text) => [text, localCount(text)]));
  const t = (text: string) => counts.get(text) ?? localCount(text);

  // ------------------------------------------------------------------ report

  console.log(`\nMeasured on the seeded league: matchday ${context.fixture?.matchdayNumber ?? '-'} `
    + `(${context.fixture?.phase ?? '-'}), club "${context.club.name}", squad of ${context.squad.length}, `
    + `${memories.length} staff notes, ${Math.min(historyRows.length, 8)} history turns.`);
  console.log(`Tokens: ${label}.  Prices as published ${PRICED_AT}, model ${MODEL}.\n`);

  const rows: Array<[string, string]> = [
    ['system prompt', COACH_SYSTEM_PROMPT],
    ['tool schema', toolJson],
    ...blocks.map((b) => [`  context: ${b.label}${b.static ? ' (static)' : ''}`,
      dataBlock(b.label, JSON.stringify(b.value, null, 1))] as [string, string]),
    ['context total', dynamicPretty],
    ['staff notes', notes],
    ['manager message', managerBlock],
    ['history (8 turns)', history],
  ];
  const w = Math.max(...rows.map(([l]) => l.length));
  console.log(`${'component'.padEnd(w)}   chars   tokens`);
  console.log('-'.repeat(w + 18));
  for (const [label, text] of rows) {
    console.log(`${label.padEnd(w)}  ${String(text.length).padStart(6)}  ${String(t(text)).padStart(7)}`);
  }
  // Billed, but not part of anything we send, so it has no character count.
  console.log(`${'tool-use system prompt (API)'.padEnd(w)}  ${'-'.padStart(6)}  `
    + `${String(toolUseSystem).padStart(7)}`);
  const inputTokens = t(COACH_SYSTEM_PROMPT) + t(toolJson) + toolUseSystem
    + t(dynamicPretty) + t(notes) + t(managerBlock) + t(history);
  console.log('-'.repeat(w + 18));
  console.log(`${'WHOLE REQUEST'.padEnd(w)}  ${' '.repeat(6)}  ${String(inputTokens).padStart(7)}`);

  console.log('\noutput, by what the proposal actually changes');
  for (const [name, value] of Object.entries(outputs)) {
    console.log(`  ${name.padEnd(10)} ${String(t(JSON.stringify(value))).padStart(5)} tokens`);
  }

  // ------------------------------------------------------------------ levers

  const price = PRICES[MODEL];
  const cost = (uncachedIn: number, cachedIn: number, out: number) =>
    (uncachedIn * price.input + cachedIn * price.input * CACHE_READ_MULTIPLIER
      + out * price.output) / 1e6;

  const staticNow = t(COACH_SYSTEM_PROMPT) + t(toolJson) + toolUseSystem;
  const tail = t(notes) + t(managerBlock) + t(history);
  const out = t(JSON.stringify(outputs.partial));
  const baseline = cost(inputTokens, 0, out);

  // Applied cheapest-and-safest first rather than largest first, which is the
  // order docs/AI_COSTS.md recommends and the order the marginal column means.
  const formationReference = dataBlock('formation_reference', JSON.stringify(
    context.availableFormations.map((f) => ({
      formation: f.formation, label: f.label, description: f.description }))));
  // Only the familiarity number varies per club, so that is all that has to
  // stay in the dynamic half once the reference moves into the prefix.
  const thinFormations = (bs: Blocks[]) => bs.map((b) => (b.label === 'available_formations'
    ? { ...b, value: (b.value as Array<{ formation: string; familiarity: number }>)
      .map((f) => ({ formation: f.formation, familiarity: f.familiarity })) }
    : b));

  console.log('\nlevers, priced on one instruction that changes tactics and training');
  console.log(`${'lever'.padEnd(44)} ${'inTok'.padStart(6)}  ${'cost'.padStart(7)}   `
    + `vs base   marginal`);
  console.log('-'.repeat(78));
  // Marginal is in points of the baseline, not of the previous row, so the
  // column sums to the total and each lever can be compared against the others.
  let previous = baseline;
  const lever = (label: string, uncached: number, cached: number) => {
    const c = cost(uncached, cached, out);
    console.log(`${label.padEnd(44)} ${String(uncached + cached).padStart(6)}  `
      + `$${c.toFixed(4)}  ${(((c / baseline) - 1) * 100).toFixed(1).padStart(7)}%  `
      + `${(((c - previous) / baseline) * 100).toFixed(1).padStart(7)}pt`);
    previous = c;
  };

  lever('0  current code', inputTokens, 0);
  lever('1  compact JSON', staticNow + t(dynamicCompact) + tail, 0);
  lever('2  + cache tools and system', t(dynamicCompact) + tail, staticNow);

  const thin = thinFormations(blocks);
  lever('3  + roles and formation reference static',
    t(render(thin.filter((b) => !b.static), false)) + tail,
    staticNow + t(render(thin.filter((b) => b.static), false)) + t(formationReference));

  const thinShort = thinFormations(withSquad(shortIdSquad));
  lever('4  + short player IDs',
    t(render(thinShort.filter((b) => !b.static), false)) + tail,
    staticNow + t(render(thinShort.filter((b) => b.static), false)) + t(formationReference));

  const thinTrim = thinFormations(withSquad(trimmedSquad));
  lever('5  + trimmed squad fields',
    t(render(thinTrim.filter((b) => !b.static), false)) + tail,
    staticNow + t(render(thinTrim.filter((b) => b.static), false)) + t(formationReference));

  console.log('\nsame prompt, different model');
  for (const [name, p] of Object.entries(PRICES)) {
    const c = (inputTokens * p.input + out * p.output) / 1e6;
    console.log(`  ${name.padEnd(20)} $${c.toFixed(4)}  ${(((c / baseline) - 1) * 100).toFixed(1).padStart(6)}%`);
  }

  console.log('\nretries: AI_MAX_RETRIES defaults to 2, so a request can be sent three times');
  console.log(`  three attempts, the last one succeeding: `
    + `$${(cost(inputTokens * 3, 0, out)).toFixed(4)}  `
    + `${(cost(inputTokens * 3, 0, out) / baseline).toFixed(2)}x one clean attempt`);
  console.log(`  a generation abandoned by the 45s timeout is still billed, `
    + `up to max_tokens: $${cost(inputTokens, 0, 3000).toFixed(4)}`);

  console.log('\nseason totals: 8 managers, 14 matchdays');
  const scenarios = [
    { name: 'light', perMatchday: 2, historyTurns: 2,
      out: (t(JSON.stringify(outputs.full)) + t(JSON.stringify(outputs.partial))) / 2 },
    { name: 'typical', perMatchday: 5, historyTurns: 8, out },
    { name: 'heavy', perMatchday: 15, historyTurns: 8,
      out: (t(JSON.stringify(outputs.partial)) + t(JSON.stringify(outputs.advice))) / 2 },
  ];
  const step3Static = staticNow + t(render(thin.filter((b) => b.static), false)) + t(formationReference);
  const step5Dynamic = t(render(thinTrim.filter((b) => !b.static), false));
  const step5Static = staticNow + t(render(thinTrim.filter((b) => b.static), false)) + t(formationReference);
  console.log(`${'scenario'.padEnd(10)} ${'instr'.padStart(6)} ${'now'.padStart(9)} `
    + `${'steps 1-2'.padStart(10)} ${'steps 1-5'.padStart(10)}`);
  for (const s2 of scenarios) {
    const n = s2.perMatchday * 14 * 8;
    const scenarioTail = t(notes) + t(managerBlock) + Math.round(t(history) * (s2.historyTurns / 8));
    const now = cost(staticNow + t(dynamicPretty) + scenarioTail, 0, s2.out) * n;
    const s12 = cost(t(dynamicCompact) + scenarioTail, staticNow, s2.out) * n;
    const s15 = cost(step5Dynamic - tail + scenarioTail, step5Static, s2.out) * n;
    console.log(`${s2.name.padEnd(10)} ${String(n).padStart(6)} `
      + `${('$' + now.toFixed(2)).padStart(9)} ${('$' + s12.toFixed(2)).padStart(10)} `
      + `${('$' + s15.toFixed(2)).padStart(10)}`);
  }
  void step3Static;

  console.log(`\ncache break-even on the ${staticNow}-token static prefix`);
  console.log('  a write costs 1.25x input, a read 0.1x, and an entry lives five minutes');
  for (const sittings of [1, 2, 3]) {
    for (const n of [2, 5, 15]) {
      if (n < sittings) continue;
      const cached = (sittings * staticNow * CACHE_WRITE_MULTIPLIER
        + (n - sittings) * staticNow * CACHE_READ_MULTIPLIER) * price.input / 1e6;
      const uncached = n * staticNow * price.input / 1e6;
      console.log(`  ${String(n).padStart(2)} instructions in ${sittings} sitting(s): `
        + `$${cached.toFixed(4)} cached vs $${uncached.toFixed(4)} uncached  `
        + `${(((cached / uncached) - 1) * 100).toFixed(0).padStart(4)}%`);
    }
  }

  await prisma.$disconnect();
}


main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
