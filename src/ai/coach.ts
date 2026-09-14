import { prisma } from '@/lib/db';
import { analyseTacticalChange, type TacticalChangeAnalysis } from '@/domain/familiarity';
import {
  coachProposalSchema, lineupSelectionSchema, tacticalPlanSchema, trainingPlanSchema,
  type CoachProposal, type LineupSelectionInput, type TacticalPlanInput, type TrainingPlanInput,
} from '@/domain/schemas';
import {
  mergeResults, validateLineup, validateSubstitutionPlan, validateTactics,
  validateTrainingPlan, type ValidationResult,
} from '@/domain/validation';
import { env } from '@/lib/env';
import { loadClubFamiliarity, loadSquad, toValidationView } from '@/services/club';
import { getPreviousPlayedPlan } from '@/services/plans';
import { recordAudit } from '@/services/audit';
import { buildCoachContext, type CoachContext } from './context';
import { AnthropicCoachProvider } from './providers/anthropic';
import { LocalCoachProvider, proposeLocally } from './providers/local';
import type { AiProvider, CoachRequest, CoachResult } from './provider';
import { clean } from './sanitize';

/**
 * The coaching staff, end to end.
 *
 * A proposal travels: manager message -> context (privacy boundary) -> provider
 * -> schema parse -> domain validation -> stored as a logged, unapplied
 * proposal. Nothing reaches game state until a human approves it, and approval
 * goes back through the same plan service that a manual edit uses.
 */

export function getProvider(): AiProvider {
  if (env.ai.provider === 'anthropic') {
    const key = env.ai.apiKey;
    if (key) return new AnthropicCoachProvider(key);
  }
  return new LocalCoachProvider();
}

export interface CoachTurnResult {
  conversationId: string;
  proposal: CoachProposal;
  validation: {
    tactics: ValidationResult | null;
    lineup: ValidationResult | null;
    training: ValidationResult | null;
    ok: boolean;
  };
  analysis: TacticalChangeAnalysis | null;
  decisions: Array<{ id: string; kind: string; status: string }>;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  warnings: string[];
}

export async function getOrCreateConversation(clubId: string, userId: string) {
  const existing = await prisma.aiConversation.findFirst({
    where: { clubId, userId }, orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.aiConversation.create({ data: { clubId, userId } });
}

export async function loadConversation(conversationId: string) {
  return prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 60 } },
  });
}

/** One exchange with the coaching staff. */
export async function askCoach(input: {
  clubId: string;
  userId: string;
  message: string;
  matchdayId?: string | null;
}): Promise<CoachTurnResult> {
  const conversation = await getOrCreateConversation(input.clubId, input.userId);
  const [context, history, memories] = await Promise.all([
    buildCoachContext(input.clubId),
    prisma.aiMessage.findMany({
      where: { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
    prisma.aiMemory.findMany({ where: { clubId: input.clubId }, orderBy: { importance: 'desc' }, take: 8 }),
  ]);

  const message = clean(input.message, 4000);
  await prisma.aiMessage.create({
    data: { conversationId: conversation.id, role: 'USER', content: message },
  });

  const request: CoachRequest = {
    message,
    history: history.map((m) => ({ role: m.role === 'USER' ? 'USER' : 'ASSISTANT', content: m.content })),
    context,
    memories: memories.map((m) => ({ key: m.key, content: m.content })),
  };

  const warnings: string[] = [];
  if (context.sanitisationFlags.length > 0) {
    warnings.push(`Instruction-like text was found and neutralised in: ${context.sanitisationFlags.join(', ')}.`);
  }

  let result: CoachResult;
  const provider = getProvider();
  try {
    result = await provider.propose(request);
  } catch (error) {
    // Provider failure must never block a manager. The local coach answers and
    // the manager is told plainly that it did.
    warnings.push(`The ${provider.name} coaching staff could not be reached: ${(error as Error).message} Falling back to the local coach.`);
    const proposal = proposeLocally(request);
    result = {
      proposal, provider: 'local', model: 'heuristic-coach-1',
      latencyMs: 0, fallbackUsed: true, warnings: [],
    };
  }
  warnings.push(...result.warnings);

  const validated = await validateProposal(input.clubId, result.proposal, context);

  await prisma.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: result.proposal.message,
      payload: JSON.parse(JSON.stringify({
        rationale: result.proposal.rationale,
        risks: result.proposal.risks,
        clarifyingQuestions: result.proposal.clarifyingQuestions,
        provider: result.provider,
        fallbackUsed: result.fallbackUsed,
      })),
    },
  });
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  // Log each proposal separately: a manager may accept the training and reject
  // the tactics, and the audit trail should show exactly that.
  const decisions: CoachTurnResult['decisions'] = [];
  const logDecision = async (kind: string, proposal: unknown, validation: ValidationResult | null) => {
    if (proposal === undefined || proposal === null) return;
    const row = await prisma.aiDecision.create({
      data: {
        clubId: input.clubId,
        matchdayId: input.matchdayId ?? undefined,
        conversationId: conversation.id,
        kind: kind as never,
        status: validation && !validation.ok ? 'INVALID' : 'PROPOSED',
        provider: result.provider,
        model: result.model,
        fallbackUsed: result.fallbackUsed,
        latencyMs: result.latencyMs,
        proposal: JSON.parse(JSON.stringify(proposal)),
        validation: JSON.parse(JSON.stringify(validation ?? { ok: true, errors: [], warnings: [] })),
        rationale: result.proposal.rationale.slice(0, 4000),
      },
    });
    decisions.push({ id: row.id, kind, status: row.status });
  };

  if (validated.mergedTactics) {
    await logDecision('TACTICAL_PLAN',
      { tactics: validated.mergedTactics, lineup: validated.lineup },
      mergeResults(...[validated.tactics, validated.lineupValidation].filter(Boolean) as ValidationResult[]));
  }
  if (validated.training) {
    await logDecision('TRAINING_PLAN', validated.training, validated.trainingValidation);
  }
  if (result.proposal.scouting) {
    await logDecision('SCOUTING_SUMMARY', result.proposal.scouting, null);
  }

  await rememberIntent(input.clubId, message, result.proposal);

  return {
    conversationId: conversation.id,
    proposal: result.proposal,
    validation: {
      tactics: validated.tactics,
      lineup: validated.lineupValidation,
      training: validated.trainingValidation,
      ok: [validated.tactics, validated.lineupValidation, validated.trainingValidation]
        .every((v) => v === null || v.ok),
    },
    analysis: validated.analysis,
    decisions,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
    warnings,
  };
}

interface ValidatedProposal {
  mergedTactics: TacticalPlanInput | null;
  lineup: LineupSelectionInput | null;
  training: TrainingPlanInput | null;
  tactics: ValidationResult | null;
  lineupValidation: ValidationResult | null;
  trainingValidation: ValidationResult | null;
  analysis: TacticalChangeAnalysis | null;
}

/**
 * Validate a proposal against the real squad and the tactical rules.
 *
 * A partial tactical proposal is merged onto the club's current plan, so the AI
 * changing one dial does not silently reset everything else.
 */
export async function validateProposal(
  clubId: string, proposal: CoachProposal, context?: CoachContext,
): Promise<ValidatedProposal> {
  const ctx = context ?? await buildCoachContext(clubId);
  const squad = await loadSquad(clubId);
  const squadView = toValidationView(squad);

  let mergedTactics: TacticalPlanInput | null = null;
  let tacticsValidation: ValidationResult | null = null;
  let analysis: TacticalChangeAnalysis | null = null;

  if (proposal.tactics) {
    const merged = tacticalPlanSchema.safeParse({ ...ctx.currentPlan, ...proposal.tactics });
    if (merged.success) {
      mergedTactics = merged.data;
      tacticsValidation = validateTactics(merged.data);
      const [familiarity, previous] = await Promise.all([
        loadClubFamiliarity(clubId), getPreviousPlayedPlan(clubId),
      ]);
      analysis = analyseTacticalChange(merged.data, familiarity, previous);
    } else {
      tacticsValidation = {
        ok: false,
        errors: merged.error.issues.map((i) => ({
          code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
        })),
        warnings: [],
      };
    }
  }

  let lineup: LineupSelectionInput | null = null;
  let lineupValidation: ValidationResult | null = null;
  if (proposal.lineup) {
    const parsed = lineupSelectionSchema.safeParse(proposal.lineup);
    if (parsed.success) {
      lineup = parsed.data;
      const formationForLineup = mergedTactics ?? ctx.currentPlan;
      lineupValidation = mergeResults(
        validateLineup(parsed.data, formationForLineup, squadView),
        validateSubstitutionPlan(formationForLineup, parsed.data, squadView));
    } else {
      lineupValidation = {
        ok: false,
        errors: parsed.error.issues.map((i) => ({
          code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
        })),
        warnings: [],
      };
    }
  }

  let training: TrainingPlanInput | null = null;
  let trainingValidation: ValidationResult | null = null;
  if (proposal.training) {
    const parsed = trainingPlanSchema.safeParse(proposal.training);
    if (parsed.success) {
      training = parsed.data;
      trainingValidation = validateTrainingPlan(parsed.data, squadView);
    } else {
      trainingValidation = {
        ok: false,
        errors: parsed.error.issues.map((i) => ({
          code: 'SCHEMA', message: i.message, path: i.path.join('.'), severity: 'ERROR' as const,
        })),
        warnings: [],
      };
    }
  }

  return {
    mergedTactics, lineup, training,
    tactics: tacticsValidation,
    lineupValidation,
    trainingValidation,
    analysis,
  };
}

/**
 * Persistent memory. The staff keep a short, human-readable note of what the
 * manager keeps asking for, so advice stays consistent week to week.
 */
async function rememberIntent(clubId: string, message: string, proposal: CoachProposal): Promise<void> {
  if (message.length < 20) return;
  await prisma.aiMemory.upsert({
    where: { clubId_key: { clubId, key: 'manager_intent' } },
    create: { clubId, key: 'manager_intent', content: message.slice(0, 500), importance: 5 },
    update: { content: message.slice(0, 500) },
  });
  if (proposal.tactics?.formation) {
    await prisma.aiMemory.upsert({
      where: { clubId_key: { clubId, key: 'last_recommended_system' } },
      create: {
        clubId, key: 'last_recommended_system', importance: 3,
        content: `${proposal.tactics.formation}, ${proposal.tactics.playingStyle ?? 'style unchanged'}`,
      },
      update: { content: `${proposal.tactics.formation}, ${proposal.tactics.playingStyle ?? 'style unchanged'}` },
    });
  }
}

/** Mark a logged proposal as accepted or rejected by the human manager. */
export async function resolveDecision(
  decisionId: string, userId: string, status: 'APPROVED' | 'REJECTED',
): Promise<void> {
  const decision = await prisma.aiDecision.findUnique({ where: { id: decisionId } });
  if (!decision) return;
  await prisma.aiDecision.update({
    where: { id: decisionId },
    data: { status, approvedById: status === 'APPROVED' ? userId : null, approvedAt: new Date() },
  });
  await recordAudit({
    action: status === 'APPROVED' ? 'AI_PROPOSAL_APPROVED' : 'AI_PROPOSAL_REJECTED',
    entity: 'AiDecision', entityId: decisionId, clubId: decision.clubId, userId,
    after: { kind: decision.kind, provider: decision.provider, fallbackUsed: decision.fallbackUsed },
  });
}

export { coachProposalSchema };
