import { prisma } from '@/lib/db';
import { getLockStatus } from '@/services/matchday';
import { loadPageContext } from '@/services/page-context';
import { AdminPanel } from '@/components/admin-panel';
import { Alert, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const context = await loadPageContext();

  if (!context.league.isAdmin) {
    return (
      <>
        <PageHeader title="Administration" />
        <Alert tone="bad" title="Not permitted">
          Only the league owner and administrators can run the matchday.
        </Alert>
      </>
    );
  }

  const [clubs, memberships] = await Promise.all([
    prisma.club.findMany({ where: { leagueId: context.league.id }, orderBy: { name: 'asc' } }),
    prisma.leagueMembership.findMany({
      where: { leagueId: context.league.id }, include: { user: true }, orderBy: { joinedAt: 'asc' },
    }),
  ]);

  let played = false;
  if (context.matchday) {
    played = (await prisma.match.count({ where: { fixture: { matchdayId: context.matchday.id } } })) > 0;
  }
  const lockStatus = context.matchday ? await getLockStatus(context.matchday.id) : null;

  return (
    <>
      <PageHeader title="Administration" subtitle={context.league.name} />
      <AdminPanel
        leagueId={context.league.id}
        inviteCode={context.league.inviteCode}
        matchday={context.matchday
          ? { id: context.matchday.id, number: context.matchday.number, phase: context.matchday.phase, played }
          : null}
        lockStatus={lockStatus}
        clubs={clubs.map((c) => ({ id: c.id, name: c.name, ownerUserId: c.ownerUserId }))}
        members={memberships.map((m) => ({ userId: m.userId, displayName: m.user.displayName }))}
        hasSeason={Boolean(context.season)}
      />
    </>
  );
}
