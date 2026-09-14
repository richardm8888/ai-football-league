import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { buildTable } from '@/domain/league/standings';
import { buildClubTrends } from '@/domain/reports/roundup';
import { canViewLeague, scoutOpponent } from '@/domain/visibility';
import { loadPlayedFixtures, loadSeasonFacts } from '@/services/simulation';
import { loadPageContext } from '@/services/page-context';
import { Alert, Badge, Card, CardTitle, Empty, formLabel, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * An opponent as seen from the outside.
 *
 * Only public results and inferences drawn from them. There is no route from
 * this page to another club's squad detail, plans, training or conversations,
 * because none of that is loaded.
 */
export default async function OpponentPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const context = await loadPageContext();

  const club = await prisma.club.findUnique({ where: { id: clubId }, include: { owner: true } });
  if (!club || !canViewLeague(context.viewer, club.leagueId)) notFound();

  const isOwnClub = club.id === context.club?.id;

  if (!context.season) {
    return (
      <>
        <PageHeader title={club.name} />
        <Empty>No season data yet.</Empty>
      </>
    );
  }

  const [seasonFacts, playedFixtures, clubs] = await Promise.all([
    loadSeasonFacts(context.season.id),
    loadPlayedFixtures(context.season.id),
    prisma.club.findMany({ where: { leagueId: club.leagueId }, select: { id: true, name: true } }),
  ]);

  const clubNames = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const trends = buildClubTrends(seasonFacts, clubNames);
  const trend = trends.clubs.find((c) => c.clubId === clubId);
  const scouting = trend ? scoutOpponent(trend) : null;
  const row = buildTable(clubs.map((c) => c.id), playedFixtures).find((r) => r.clubId === clubId);

  const recent = seasonFacts
    .filter((m) => m.home.clubId === clubId || m.away.clubId === clubId)
    .slice(-5)
    .reverse();

  return (
    <>
      <Link href="/league" className="mb-3 inline-block text-sm text-brand-400">← League</Link>
      <PageHeader
        title={club.name}
        subtitle={`${club.nickname ? `${club.nickname} · ` : ''}${club.stadium}${club.owner ? ` · managed by ${club.owner.displayName}` : ''}`}
      />

      {!isOwnClub && (
        <Alert tone="info" title="Scouting report">
          Everything below is inferred from published match data. It is an estimate, not inside
          information, and every manager in the league can see the same figures.
        </Alert>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {row && (
          <Card>
            <CardTitle>Record</CardTitle>
            <p className="text-lg font-semibold">
              {row.position}
              <span className="text-sm font-normal text-ink-400"> · {row.points} pts</span>
            </p>
            <p className="mt-1 text-sm text-ink-400">
              {row.played} played · {row.won}W {row.drawn}D {row.lost}L · {row.goalsFor}-{row.goalsAgainst}
            </p>
            {row.formGuide && <div className="mt-2">{formLabel(row.formGuide)}</div>}
          </Card>
        )}

        <Card>
          <CardTitle>How they play</CardTitle>
          {scouting ? (
            <>
              <div className="mb-3">
                <Badge tone={scouting.confidence === 'HIGH' ? 'good' : scouting.confidence === 'MEDIUM' ? 'info' : 'warn'}>
                  {scouting.confidence.toLowerCase()} confidence · {scouting.matchesObserved} match{scouting.matchesObserved === 1 ? '' : 'es'} observed
                </Badge>
              </div>
              <ul className="space-y-2.5">
                {scouting.observations.map((observation) => (
                  <li key={observation.label}>
                    <p className="text-sm">
                      <span className="font-medium">{observation.label}:</span>{' '}
                      <span className="text-ink-200">{observation.estimate}</span>
                    </p>
                    <p className="text-[11px] text-ink-500">Based on {observation.basis}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs italic text-ink-500">{scouting.caveat}</p>
            </>
          ) : (
            <Empty>They have not played yet, so there is nothing to read.</Empty>
          )}
        </Card>

        <Card className="sm:col-span-2">
          <CardTitle>Recent matches</CardTitle>
          {recent.length === 0 ? (
            <Empty>No matches played.</Empty>
          ) : (
            <ul className="space-y-2">
              {recent.map((match) => {
                const isHome = match.home.clubId === clubId;
                const them = isHome ? match.home : match.away;
                const other = isHome ? match.away : match.home;
                const result = them.goals > other.goals ? 'W' : them.goals === other.goals ? 'D' : 'L';
                return (
                  <li key={match.fixtureId} className="rounded-xl bg-pitch-850 p-3">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold ${
                        result === 'W' ? 'bg-brand-600 text-pitch-950' : result === 'D' ? 'bg-ink-500 text-pitch-950' : 'bg-danger-500 text-pitch-950'
                      }`}
                      >
                        {result}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {isHome ? 'vs' : 'at'} {other.name}
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums">{them.goals}–{other.goals}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      {them.formationLabel} · {them.possession}% possession · {them.shots} shots ·
                      {' '}{them.expectedGoals} xG · {them.pressingRate} defensive actions per opposition sequence
                      {them.inMatchChanges > 0 ? ` · ${them.inMatchChanges} in-match adjustment${them.inMatchChanges === 1 ? '' : 's'}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
