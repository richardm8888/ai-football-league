import Link from 'next/link';
import { prisma } from '@/lib/db';
import { buildTable } from '@/domain/league/standings';
import { buildClubTrends } from '@/domain/reports/roundup';
import { loadPlayedFixtures, loadSeasonFacts } from '@/services/simulation';
import { loadPageContext } from '@/services/page-context';
import { Card, CardTitle, Empty, formLabel, LinkButton, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LeaguePage() {
  const context = await loadPageContext();
  const clubs = await prisma.club.findMany({
    where: { leagueId: context.league.id },
    include: { owner: true },
    orderBy: { name: 'asc' },
  });

  if (!context.season) {
    return (
      <>
        <PageHeader title={context.league.name} />
        <Empty>No season has been created for this league yet.</Empty>
      </>
    );
  }

  const [playedFixtures, seasonFacts] = await Promise.all([
    loadPlayedFixtures(context.season.id),
    loadSeasonFacts(context.season.id),
  ]);
  const clubNames = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const table = buildTable(clubs.map((c) => c.id), playedFixtures);
  const trends = buildClubTrends(seasonFacts, clubNames);

  return (
    <>
      <PageHeader
        title={context.league.name}
        subtitle={`${context.season.name} · ${clubs.length} clubs · invite code ${context.league.inviteCode}`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <LinkButton href="/match-centre" tone="secondary">Match centre</LinkButton>
        <LinkButton href="/reports" tone="secondary">Reports</LinkButton>
      </div>

      <Card className="mb-4">
        <CardTitle>Table</CardTitle>
        <div className="scroll-x -mx-4 px-4">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">League table</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-500">
                <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">Club</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">P</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">W</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">D</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">L</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">GD</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Pts</th>
                <th scope="col" className="py-1.5 font-medium">Form</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const isOwn = row.clubId === context.club?.id;
                return (
                  <tr key={row.clubId} className={`border-t border-line-700/50 ${isOwn ? 'bg-brand-600/10' : ''}`}>
                    <td className="py-2 pr-2 tabular-nums text-ink-400">{row.position}</td>
                    <td className="pr-3">
                      <Link
                        href={`/opponent/${row.clubId}`}
                        className={`flex min-h-11 items-center ${isOwn ? 'font-semibold text-brand-400' : 'hover:underline'}`}
                      >
                        {clubNames[row.clubId]}
                      </Link>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.played}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.won}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.drawn}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.lost}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                    <td className="py-2 pr-3 text-right font-bold tabular-nums">{row.points}</td>
                    <td className="py-2">{row.formGuide ? formLabel(row.formGuide) : <span className="text-ink-500">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>What the league is doing</CardTitle>
        {trends.clubs.length === 0 ? (
          <Empty>Trends appear once matches have been played.</Empty>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              ['Press most aggressively', trends.mostAggressivePress],
              ['Dominate possession', trends.mostPossession],
              ['Go long most often', trends.mostDirect],
              ['Concede most from transitions', trends.vulnerableToCounters],
              ['Change shape most', trends.mostRotatedShape],
            ].map(([label, names]) => (
              <div key={String(label)} className="rounded-xl bg-pitch-850 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
                <dd className="mt-1 text-sm">{(names as string[]).join(', ') || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-ink-500">
          Derived from published match data. Every manager sees exactly the same figures.
        </p>
      </Card>

      <Card>
        <CardTitle>Managers</CardTitle>
        <ul className="space-y-1.5">
          {clubs.map((club) => (
            <li key={club.id} className="flex items-center gap-3 rounded-xl bg-pitch-850 px-3 py-2.5">
              <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-md border border-white/15" style={{ background: club.primaryColor }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{club.name}</span>
                <span className="block text-xs text-ink-500">
                  {club.owner ? club.owner.displayName : 'Unclaimed'} · {club.stadium}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
