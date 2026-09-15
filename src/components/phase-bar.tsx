import Link from 'next/link';
import type { MatchdayPhase } from '@/domain/types';
import { PHASE_DESCRIPTIONS, PHASE_LABELS, PHASE_ORDER } from '@/services/matchday';
import { Badge } from './ui';

/**
 * The matchday status strip.
 *
 * The single most important thing on a phone: which week is it, what phase is
 * the league in, and has this manager locked in yet.
 */
export function PhaseBar({
  matchdayNumber, phase, planStatus, deadlineAt,
}: {
  matchdayNumber: number;
  phase: MatchdayPhase;
  planStatus: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'LOCKED' | null;
  deadlineAt: Date | null;
}) {
  const index = PHASE_ORDER.indexOf(phase);
  const progress = ((index + 1) / PHASE_ORDER.length) * 100;

  const statusTone = planStatus === 'LOCKED' ? 'good'
    : planStatus === 'APPROVED' ? 'info'
      : phase === 'POST_MATCH' || phase === 'COMPLETE' ? 'neutral' : 'warn';
  const statusLabel = planStatus === 'LOCKED' ? 'Locked in'
    : planStatus === 'APPROVED' ? 'Approved, not locked'
      : planStatus === 'PROPOSED' ? 'Awaiting your approval' : 'Not submitted';

  return (
    <div className="mb-4 rounded-2xl border border-line-700/60 bg-pitch-900/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-pitch-800 px-2 py-1 text-xs font-bold tracking-wide text-brand-400">
            MATCHDAY {matchdayNumber}
          </span>
          <span className="text-sm font-semibold">{PHASE_LABELS[phase]}</span>
        </div>
        {planStatus && <Badge tone={statusTone}>{statusLabel}</Badge>}
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-pitch-800">
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <p className="mt-2.5 text-sm text-ink-400">{PHASE_DESCRIPTIONS[phase]}</p>

      {deadlineAt && phase !== 'POST_MATCH' && phase !== 'COMPLETE' && (
        <p className="mt-1 text-xs text-ink-500">
          Deadline {new Date(deadlineAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
      )}

      {planStatus !== 'LOCKED' && phase === 'OPEN' && (
        <Link href="/tactics" className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand-600 px-4 font-semibold text-pitch-950">
          Review and lock your plan
        </Link>
      )}
    </div>
  );
}
