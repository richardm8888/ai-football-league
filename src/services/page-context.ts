import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import type { MatchdayPhase } from '@/domain/types';
import type { Viewer } from '@/domain/visibility';
import { getCurrentUser, getViewer, type CurrentUser } from './auth';

/**
 * The state every management screen needs: who is looking, which club they
 * manage, and where the league has got to this week.
 *
 * Loading it in one place keeps authorisation decisions consistent: a page that
 * has a PageContext has already established that this user owns this club.
 */

export interface PageContext {
  user: CurrentUser;
  viewer: Viewer;
  league: { id: string; name: string; inviteCode: string; isAdmin: boolean };
  club: {
    id: string; name: string; shortName: string; nickname: string | null;
    stadium: string; primaryColor: string; reputation: number; morale: number;
  } | null;
  season: { id: string; name: string } | null;
  matchday: {
    id: string; number: number; phase: MatchdayPhase; deadlineAt: Date | null;
  } | null;
  fixture: {
    id: string;
    opponentName: string;
    opponentClubId: string;
    venue: 'HOME' | 'AWAY';
    played: boolean;
  } | null;
  planStatus: 'DRAFT' | 'PROPOSED' | 'APPROVED' | 'LOCKED' | null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function loadPageContext(): Promise<PageContext> {
  const user = await requireUser();
  const viewer = await getViewer(user.id);

  const membership = await prisma.leagueMembership.findFirst({
    where: { userId: user.id },
    include: { league: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (!membership) redirect('/join');

  const club = await prisma.club.findFirst({
    where: { leagueId: membership.leagueId, ownerUserId: user.id },
  });

  const season = await prisma.season.findFirst({
    where: { leagueId: membership.leagueId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
    ?? await prisma.season.findFirst({
      where: { leagueId: membership.leagueId },
      orderBy: { createdAt: 'desc' },
    });

  const matchday = season
    ? (await prisma.matchday.findFirst({
      where: { seasonId: season.id, phase: { not: 'COMPLETE' } },
      orderBy: { number: 'asc' },
    }) ?? await prisma.matchday.findFirst({
      where: { seasonId: season.id }, orderBy: { number: 'desc' },
    }))
    : null;

  let fixture: PageContext['fixture'] = null;
  let planStatus: PageContext['planStatus'] = null;

  if (club && matchday) {
    const row = await prisma.fixture.findFirst({
      where: { matchdayId: matchday.id, OR: [{ homeClubId: club.id }, { awayClubId: club.id }] },
      include: { homeClub: true, awayClub: true, match: true, matchPlans: { where: { clubId: club.id } } },
    });
    if (row) {
      const isHome = row.homeClubId === club.id;
      fixture = {
        id: row.id,
        opponentName: isHome ? row.awayClub.name : row.homeClub.name,
        opponentClubId: isHome ? row.awayClubId : row.homeClubId,
        venue: isHome ? 'HOME' : 'AWAY',
        played: Boolean(row.match),
      };
      planStatus = (row.matchPlans[0]?.status as PageContext['planStatus']) ?? 'DRAFT';
    }
  }

  return {
    user,
    viewer,
    league: {
      id: membership.leagueId,
      name: membership.league.name,
      inviteCode: membership.league.inviteCode,
      isAdmin: membership.role === 'OWNER' || membership.role === 'ADMIN' || user.isSuperAdmin,
    },
    club,
    season: season ? { id: season.id, name: season.name } : null,
    matchday: matchday
      ? {
        id: matchday.id,
        number: matchday.number,
        phase: matchday.phase as MatchdayPhase,
        deadlineAt: matchday.deadlineAt,
      }
      : null,
    fixture,
    planStatus,
  };
}

/** Fail closed: a page that asks for a club must have one this user manages. */
export async function requireClubContext(): Promise<PageContext & { club: NonNullable<PageContext['club']> }> {
  const context = await loadPageContext();
  // Somebody in the league who has not taken a club yet is not lost: they are
  // one step short of playing, so send them to the step rather than an error.
  if (!context.club) redirect('/choose-club');
  return context as PageContext & { club: NonNullable<PageContext['club']> };
}
