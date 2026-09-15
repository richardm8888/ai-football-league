import Link from 'next/link';
import { prisma } from '@/lib/db';
import { familiarityFor, overallTacticalStability } from '@/domain/familiarity';
import { buildTable } from '@/domain/league/standings';
import { getFormation } from '@/domain/tactics/formations';
import { loadClubFamiliarity, loadSquad } from '@/services/club';
import { getOrCreateMatchPlan } from '@/services/plans';
import { loadPlayedFixtures } from '@/services/simulation';
import { loadPageContext } from '@/services/page-context';
import { PhaseBar } from '@/components/phase-bar';
import {
  Alert, Badge, Card, CardTitle, Empty, formLabel, LinkButton, Meter, PageHeader,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ClubPage() {
  const context = await loadPageContext();

  if (!context.club) {
    return (
      <>
        <PageHeader title="No club yet" subtitle={context.league.name} />
        <Alert tone="warn" title="You are in the league but have not taken a club">
          <p>Pick the one you fancy: you can see what each is known for and how it is doing.</p>
          <p className="mt-2">Share this invite code with anyone else joining:</p>
          <p className="mt-1 font-mono text-lg tracking-[0.2em] text-brand-400">{context.league.inviteCode}</p>
        </Alert>
        <LinkButton href="/choose-club" className="mt-3">Choose your club</LinkButton>
      </>
    );
  }

  const club = context.club;
  const [squad, familiarity] = await Promise.all([loadSquad(club.id), loadClubFamiliarity(club.id)]);
  const plan = context.fixture ? await getOrCreateMatchPlan(context.fixture.id, club.id, squad) : null;
  const values = plan ? familiarityFor(familiarity, plan.tactics) : null;

  const table = context.season
    ? buildTable(
      (await prisma.club.findMany({ where: { leagueId: context.league.id }, select: { id: true } })).map((c) => c.id),
      await loadPlayedFixtures(context.season.id))
    : [];
  const row = table.find((r) => r.clubId === club.id);

  const available = squad.filter((p) => p.available);
  const injured = squad.filter((p) => p.injury !== 'NONE');
  const suspended = squad.filter((p) => p.suspensionMatches > 0);
  const averageFitness = available.length > 0
    ? Math.round(available.reduce((a, p) => a + p.fitness, 0) / available.length) : 0;

  const lastMatch = context.season
    ? await prisma.report.findFirst({
      where: {
        seasonId: context.season.id,
        kind: 'MATCH_REPORT',
        fixture: { OR: [{ homeClubId: club.id }, { awayClubId: club.id }] },
      },
      orderBy: { publishedAt: 'desc' },
    })
    : null;

  return (
    <>
      <PageHeader
        title={club.name}
        subtitle={`${club.nickname ? `${club.nickname} · ` : ''}${club.stadium}`}
      />

      {context.matchday && (
        <PhaseBar
          matchdayNumber={context.matchday.number}
          phase={context.matchday.phase}
          planStatus={context.planStatus}
          deadlineAt={context.matchday.deadlineAt}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>{context.fixture?.played ? 'This week\u2019s fixture' : 'Next fixture'}</CardTitle>
          {context.fixture ? (
            <div>
              <p className="text-lg font-semibold">
                {context.fixture.venue === 'HOME' ? 'vs' : 'away to'} {context.fixture.opponentName}
              </p>
              <p className="mt-0.5 text-sm text-ink-400">
                {context.fixture.venue === 'HOME' ? `At ${club.stadium}` : 'On the road'}
                {context.fixture.played ? ' · played' : ''}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LinkButton href={`/opponent/${context.fixture.opponentClubId}`} tone="ghost">
                  Scout them
                </LinkButton>
                {!context.fixture.played && <LinkButton href="/tactics">Set up the team</LinkButton>}
              </div>
            </div>
          ) : (
            <Empty>No fixture scheduled.</Empty>
          )}
        </Card>

        <Card>
          <CardTitle>League</CardTitle>
          {row ? (
            <div className="space-y-2">
              <p className="text-lg font-semibold">
                {row.position}
                <span className="text-sm font-normal text-ink-400"> of {table.length}</span>
                <span className="ml-2">{row.points} pts</span>
              </p>
              <p className="text-sm text-ink-400">
                {row.played} played · {row.won}W {row.drawn}D {row.lost}L · {row.goalsFor}-{row.goalsAgainst}
              </p>
              {row.formGuide && <div className="pt-1">{formLabel(row.formGuide)}</div>}
            </div>
          ) : (
            <Empty>The season has not started.</Empty>
          )}
        </Card>

        <Card className="sm:col-span-2">
          <CardTitle
            action={<Link href="/tactics" className="text-xs text-brand-400 underline underline-offset-4">Change system</Link>}
          >
            Tactical familiarity
          </CardTitle>
          {values && plan ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-pitch-850 px-3 py-2.5">
                <span className="text-sm text-ink-200">{getFormation(plan.tactics.formation).label} · overall stability</span>
                <span className="text-xl font-bold tabular-nums">
                  {overallTacticalStability(familiarity, plan.tactics)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Meter label={`${getFormation(plan.tactics.formation).label} shape`} value={values.formation} />
                <Meter label="Playing style" value={values.playingStyle} />
                <Meter label="Pressing" value={values.pressing} />
                <Meter label="Defensive organisation" value={values.defensiveOrganisation} />
                <Meter label="Build-up" value={values.buildUp} />
                <Meter label="Transitions" value={values.transition} />
                <Meter label="Set pieces" value={values.setPieces} />
                <Meter label="Squad cohesion" value={familiarity.OVERALL_STABILITY} />
              </div>
            </div>
          ) : (
            <Empty>Familiarity appears once a system is selected.</Empty>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/squad" className="text-xs text-brand-400 underline underline-offset-4">Squad</Link>}>
            Condition
          </CardTitle>
          <div className="space-y-3">
            <Meter label="Average fitness of available players" value={averageFitness} />
            <Meter label="Squad morale" value={club.morale} />
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge tone="good">{available.length} available</Badge>
              {injured.length > 0 && <Badge tone="bad">{injured.length} injured</Badge>}
              {suspended.length > 0 && <Badge tone="warn">{suspended.length} suspended</Badge>}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle action={<Link href="/reports" className="text-xs text-brand-400 underline underline-offset-4">All reports</Link>}>
            Last time out
          </CardTitle>
          {lastMatch ? (
            <p className="text-sm leading-relaxed text-ink-200">{lastMatch.narrative}</p>
          ) : (
            <Empty>No matches played yet.</Empty>
          )}
        </Card>
      </div>
    </>
  );
}
