import { getOrCreateConversation, loadConversation } from '@/ai/coach';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { canEditPlans } from '@/domain/validation';
import { getFormation } from '@/domain/tactics/formations';
import { requireClubContext } from '@/services/page-context';
import { CoachChat, type CoachDecision, type CoachMessage } from '@/components/coach-chat';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

interface AssistantPayload {
  rationale?: string;
  risks?: string[];
  clarifyingQuestions?: string[];
  provider?: string;
  fallbackUsed?: boolean;
}

export default async function CoachPage() {
  const context = await requireClubContext();

  const [aiManager, conversation] = await Promise.all([
    prisma.aiManager.findUnique({ where: { clubId: context.club.id } }),
    getOrCreateConversation(context.club.id, context.user.id).then((c) => loadConversation(c.id)),
  ]);

  const messages: CoachMessage[] = (conversation?.messages ?? [])
    .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
    .map((m) => {
      const payload = (m.payload ?? {}) as AssistantPayload;
      return {
        id: m.id,
        role: m.role as 'USER' | 'ASSISTANT',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        rationale: payload.rationale,
        risks: payload.risks,
        questions: payload.clarifyingQuestions,
        provider: payload.provider,
        fallbackUsed: payload.fallbackUsed,
      };
    });

  const pending = await prisma.aiDecision.findMany({
    where: { clubId: context.club.id, status: { in: ['PROPOSED', 'INVALID'] } },
    orderBy: { createdAt: 'desc' },
    take: 4,
  });

  const decisions: CoachDecision[] = pending.map((decision) => {
    const validation = decision.validation as { errors?: Array<{ message: string }>; warnings?: Array<{ message: string }> };
    return {
      id: decision.id,
      kind: decision.kind,
      status: decision.status,
      summary: summarise(decision.kind, decision.proposal),
      errors: (validation.errors ?? []).map((e) => e.message),
      warnings: (validation.warnings ?? []).map((w) => w.message),
      createdAt: decision.createdAt.toISOString(),
    };
  });

  const editable = context.matchday
    ? canEditPlans(context.matchday.phase, context.planStatus ?? 'DRAFT').ok
    : false;

  return (
    <>
      <PageHeader
        title="Coaching staff"
        subtitle={context.fixture
          ? `Preparing for ${context.fixture.venue === 'HOME' ? '' : 'a trip to '}${context.fixture.opponentName}`
          : 'No fixture scheduled'}
      />
      <CoachChat
        clubId={context.club.id}
        matchdayId={context.matchday?.id ?? null}
        coachName={aiManager?.name ?? 'Coaching staff'}
        coachPersona={aiManager?.persona ?? 'Analyses the squad and translates your intent into a plan.'}
        messages={messages}
        decisions={decisions}
        providerLabel={env.ai.provider === 'anthropic' ? `${env.ai.model}` : 'the local coach (no provider key configured)'}
        editable={editable}
      />
    </>
  );
}

/** A one-line human summary of a stored proposal, built from its own fields. */
function summarise(kind: string, proposal: unknown): string {
  const value = proposal as Record<string, unknown>;
  if (kind === 'TACTICAL_PLAN') {
    const tactics = (value.tactics ?? {}) as Record<string, string>;
    const parts = [
      tactics.formation ? getFormation(tactics.formation as never).label : null,
      tactics.playingStyle ? tactics.playingStyle.replace(/_/g, ' ').toLowerCase() : null,
      tactics.pressing ? `${tactics.pressing.toLowerCase()} pressing` : null,
      tactics.defensiveLine ? `${tactics.defensiveLine.replace(/_/g, ' ').toLowerCase()} line` : null,
    ].filter(Boolean);
    const lineup = value.lineup as { starters?: unknown[] } | undefined;
    const eleven = lineup?.starters?.length ? ` and a starting eleven` : '';
    return `${parts.join(', ')}${eleven}.`;
  }
  if (kind === 'TRAINING_PLAN') {
    return `${String(value.primaryFocus ?? '').replace(/_/g, ' ').toLowerCase()} with ${String(value.secondaryFocus ?? '').replace(/_/g, ' ').toLowerCase()}, at ${String(value.intensity ?? '').toLowerCase()} intensity.`;
  }
  return 'A proposal from your coaching staff.';
}
