import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getFormation } from '@/domain/tactics/formations';
import { getLockStatus } from '@/services/matchday';
import { loadPageContext } from '@/services/page-context';
import { Alert, Badge, Card, CardTitle, Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MatchCentrePage() {
  const context = await loadPageContext();
  if (!context.matchday) {
    return (
      <>
        <PageHeader title="Match centre" />
        <Empty>No matchday is in progress.</Empty>
      </>
    );
  }

  const [fixtures, lockStatus] = await Promise.all([
    prisma.fixture.findMany({
      where: { matchdayId: context.matchday.id },
      include: {
        homeClub: true, awayClub: true,
        match: { include: { statistics: true, events: { where: { type: 'GOAL' }, orderBy: { minute: 'asc' } } } },
        matchPlans: { include: { tactics: true } },
      },
      orderBy: { homeClubId: 'asc' },
    }),
    getLockStatus(context.matchday.id),
  ]);

  const played = fixtures.some((f) => f.match);

  return (
    <>
      <PageHeader
        title="Match centre"
        subtitle={`Matchday ${context.matchday.number}`}
      />

      {!played && (
        <Alert tone={lockStatus.allLocked ? 'good' : 'warn'} title={
          lockStatus.allLocked ? 'Every club is locked in' : `${lockStatus.locked} of ${lockStatus.total} clubs locked in`
        }
        >
          {lockStatus.allLocked
            ? 'The fixtures can be simulated.'
            : `Still waiting on: ${lockStatus.outstanding.map((c) => c.clubName).join(', ')}.`}
        </Alert>
      )}

      <ul className="mt-4 space-y-3">
        {fixtures.map((fixture) => {
          const home = fixture.match?.statistics.find((s) => s.side === 'HOME');
          const away = fixture.match?.statistics.find((s) => s.side === 'AWAY');
          // Formations become public only once the match has been played.
          const homePlan = fixture.match ? fixture.matchPlans.find((p) => p.clubId === fixture.homeClubId) : null;
          const awayPlan = fixture.match ? fixture.matchPlans.find((p) => p.clubId === fixture.awayClubId) : null;

          return (
            <li key={fixture.id}>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">{fixture.homeClub.name}</span>
                  <span className="shrink-0 rounded-lg bg-pitch-800 px-3 py-1.5 text-base font-bold tabular-nums">
                    {fixture.match ? `${fixture.match.homeGoals} – ${fixture.match.awayGoals}` : 'v'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{fixture.awayClub.name}</span>
                </div>

                {fixture.match ? (
                  <>
                    {fixture.match.events.length > 0 && (
                      <p className="mt-2 text-center text-xs text-ink-400">
                        {fixture.match.events.map((e) => `${e.description.replace(/^GOAL! /, '')} (${e.minute}′)`).join(' · ')}
                      </p>
                    )}
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      {[
                        ['Possession', `${home?.possession ?? 0}%`, `${away?.possession ?? 0}%`],
                        ['Shots', home?.shots ?? 0, away?.shots ?? 0],
                        ['On target', home?.shotsOnTarget ?? 0, away?.shotsOnTarget ?? 0],
                        ['Expected goals', home?.expectedGoals?.toFixed(2) ?? '0', away?.expectedGoals?.toFixed(2) ?? '0'],
                        ['Corners', home?.corners ?? 0, away?.corners ?? 0],
                        ['Cards', `${home?.yellowCards ?? 0}Y ${home?.redCards ?? 0}R`, `${away?.yellowCards ?? 0}Y ${away?.redCards ?? 0}R`],
                      ].map(([label, h, a]) => (
                        <div key={String(label)} className="rounded-lg bg-pitch-850 px-1 py-2">
                          <dt className="text-[10px] uppercase tracking-wide text-ink-500">{label}</dt>
                          <dd className="mt-0.5 tabular-nums">{h} <span className="text-ink-600">·</span> {a}</dd>
                        </div>
                      ))}
                    </dl>
                    {homePlan?.tactics && awayPlan?.tactics && (
                      <p className="mt-2 text-center text-[11px] text-ink-500">
                        {getFormation(homePlan.tactics.formation as never).label} v {getFormation(awayPlan.tactics.formation as never).label}
                      </p>
                    )}
                    <div className="mt-3 text-center">
                      <Link href={`/reports?fixture=${fixture.id}`} className="text-xs text-brand-400 underline underline-offset-4">
                        Full report
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-center text-xs text-ink-500">
                    Kick-off pending. Formations and statistics are published after the match.
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
