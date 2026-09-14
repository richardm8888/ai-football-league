import Link from 'next/link';
import { prisma } from '@/lib/db';
import type { LeagueRoundup } from '@/domain/reports/roundup';
import { loadPageContext } from '@/services/page-context';
import { Badge, Card, CardTitle, Empty, formLabel, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: { searchParams: Promise<{ matchday?: string; fixture?: string }> }) {
  const params = await searchParams;
  const context = await loadPageContext();
  if (!context.season) {
    return (
      <>
        <PageHeader title="Reports" />
        <Empty>No season yet.</Empty>
      </>
    );
  }

  if (params.fixture) {
    const report = await prisma.report.findFirst({
      where: { seasonId: context.season.id, kind: 'MATCH_REPORT', fixtureId: params.fixture },
    });
    return (
      <>
        <Link href="/reports" className="mb-3 inline-block text-sm text-brand-400">← All reports</Link>
        <PageHeader title="Match report" />
        {report ? (
          <Card><p className="text-sm leading-relaxed text-ink-100">{report.narrative}</p></Card>
        ) : (
          <Empty>That match has not been played yet.</Empty>
        )}
      </>
    );
  }

  const roundups = await prisma.report.findMany({
    where: { seasonId: context.season.id, kind: 'LEAGUE_ROUNDUP' },
    include: { matchday: true },
    orderBy: { matchday: { number: 'desc' } },
    take: 20,
  });

  if (roundups.length === 0) {
    return (
      <>
        <PageHeader title="Reports" />
        <Empty>Reports are published to the whole league once a matchday has been simulated.</Empty>
      </>
    );
  }

  const selectedNumber = params.matchday ? Number(params.matchday) : roundups[0].matchday.number;
  const selected = roundups.find((r) => r.matchday.number === selectedNumber) ?? roundups[0];
  const roundup = selected.payload as unknown as LeagueRoundup;

  return (
    <>
      <PageHeader title="League report" subtitle={`Matchday ${roundup.matchdayNumber}`} />

      <div className="scroll-x -mx-4 mb-4 px-4">
        <div className="flex w-max gap-2">
          {roundups.map((report) => (
            <Link
              key={report.id}
              href={`/reports?matchday=${report.matchday.number}`}
              className={`min-h-11 whitespace-nowrap rounded-full border px-4 py-2.5 text-sm ${
                report.matchday.number === roundup.matchdayNumber
                  ? 'border-brand-500 bg-brand-600/20 text-brand-400'
                  : 'border-line-700 bg-pitch-900 text-ink-300'
              }`}
            >
              MD {report.matchday.number}
            </Link>
          ))}
        </div>
      </div>

      {roundup.headlines.length > 0 && (
        <Card className="mb-4">
          <CardTitle>Headlines</CardTitle>
          <ul className="space-y-1.5 text-sm text-ink-100">
            {roundup.headlines.map((headline, i) => <li key={i}>{headline}</li>)}
          </ul>
        </Card>
      )}

      <Card className="mb-4">
        <CardTitle>Results</CardTitle>
        <ul className="space-y-3">
          {roundup.results.map((result) => (
            <li key={result.fixtureId} className="rounded-xl bg-pitch-850 p-3">
              <div className="flex items-center justify-between gap-2 text-sm font-medium">
                <span className="min-w-0 flex-1 truncate text-right">{result.homeName}</span>
                <span className="shrink-0 rounded bg-pitch-800 px-2 py-1 tabular-nums">
                  {result.homeGoals} – {result.awayGoals}
                </span>
                <span className="min-w-0 flex-1 truncate">{result.awayName}</span>
              </div>
              <p className="mt-1 text-center text-[11px] text-ink-500">
                {result.homeFormation} v {result.awayFormation} ·
                {' '}possession {result.homePossession}% / {result.awayPossession}% ·
                {' '}xG {result.homeExpectedGoals} / {result.awayExpectedGoals}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-300">{result.narrative}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Top performers</CardTitle>
          <ul className="space-y-1.5">
            {roundup.topPerformers.map((player) => (
              <li key={player.playerId} className="flex items-center justify-between gap-2 rounded-lg bg-pitch-850 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{player.name}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {player.clubName} · {player.goals}g {player.assists}a
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-brand-400">{player.rating.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>Table after this round</CardTitle>
          <ul className="space-y-1">
            {roundup.table.map((row) => (
              <li key={row.clubId} className="flex items-center gap-2 px-1 py-1 text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums text-ink-500">{row.position}</span>
                <span className="min-w-0 flex-1 truncate">{row.clubName}</span>
                {row.formGuide && <span className="shrink-0">{formLabel(row.formGuide)}</span>}
                <span className="w-8 shrink-0 text-right font-bold tabular-nums">{row.points}</span>
              </li>
            ))}
          </ul>
        </Card>

        {roundup.publicInjuries.length > 0 && (
          <Card>
            <CardTitle>Injury list</CardTitle>
            <ul className="space-y-1.5 text-sm">
              {roundup.publicInjuries.map((entry, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{entry.playerName}</span>
                    <span className="block truncate text-xs text-ink-500">{entry.clubName}</span>
                  </span>
                  <Badge tone="bad">{entry.note}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {roundup.suspensions.length > 0 && (
          <Card>
            <CardTitle>Suspensions</CardTitle>
            <ul className="space-y-1.5 text-sm">
              {roundup.suspensions.map((entry, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{entry.playerName} <span className="text-ink-500">({entry.clubName})</span></span>
                  <Badge tone="warn">{entry.matches} match{entry.matches === 1 ? '' : 'es'}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
