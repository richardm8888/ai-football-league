import { prisma } from '@/lib/db';
import type { MatchdayPhase } from '@/domain/types';
import { MATCHDAY_PHASES } from '@/domain/types';
import { recordAudit } from './audit';

/**
 * The weekly state machine.
 *
 * Phases move forward one step at a time and never backwards, except by an
 * explicit administrator reopen, which is audited. Every action that changes
 * competitive state asks this module whether the phase permits it.
 */

export class MatchdayError extends Error {}

export const PHASE_ORDER: MatchdayPhase[] = [...MATCHDAY_PHASES];

export const PHASE_LABELS: Record<MatchdayPhase, string> = {
  WEEK_OPEN: 'Week open',
  ANALYSIS: 'Analysis',
  PREPARATION: 'Preparation',
  TACTICAL_SUBMISSION: 'Tactics',
  REVIEW_AND_APPROVAL: 'Review and approval',
  LOCKED: 'Locked',
  SIMULATION: 'Simulating',
  POST_MATCH: 'Post match',
  COMPLETE: 'Complete',
};

export const PHASE_DESCRIPTIONS: Record<MatchdayPhase, string> = {
  WEEK_OPEN: 'The new matchday is open. Review your club and your next opponent.',
  ANALYSIS: 'Study the squad, recent form and what the opposition have been doing.',
  PREPARATION: 'Set training priorities and work through ideas with your coaching staff.',
  TACTICAL_SUBMISSION: 'Choose a formation, line-up, roles and instructions.',
  REVIEW_AND_APPROVAL: 'Check the warnings, approve the plan and lock it in.',
  LOCKED: 'Plans are frozen. Waiting for the rest of the league.',
  SIMULATION: 'Fixtures are being simulated.',
  POST_MATCH: 'Results and reports are published.',
  COMPLETE: 'This matchday is finished.',
};

export function nextPhase(phase: MatchdayPhase): MatchdayPhase | null {
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0 || index >= PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[index + 1];
}

export function phaseAtOrAfter(phase: MatchdayPhase, target: MatchdayPhase): boolean {
  return PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(target);
}

export async function getCurrentMatchday(seasonId: string) {
  const unfinished = await prisma.matchday.findFirst({
    where: { seasonId, phase: { not: 'COMPLETE' } },
    orderBy: { number: 'asc' },
    include: {
      fixtures: {
        include: { homeClub: true, awayClub: true, match: true },
        orderBy: { homeClubId: 'asc' },
      },
    },
  });
  if (unfinished) return unfinished;
  return prisma.matchday.findFirst({
    where: { seasonId },
    orderBy: { number: 'desc' },
    include: {
      fixtures: {
        include: { homeClub: true, awayClub: true, match: true },
        orderBy: { homeClubId: 'asc' },
      },
    },
  });
}

export async function getMatchday(matchdayId: string) {
  return prisma.matchday.findUnique({
    where: { id: matchdayId },
    include: {
      season: true,
      fixtures: { include: { homeClub: true, awayClub: true, match: true, matchPlans: true } },
    },
  });
}

/** Move a matchday on one phase. Simulation and post-match are driven by the simulator. */
export async function advancePhase(matchdayId: string, userId: string): Promise<MatchdayPhase> {
  const matchday = await prisma.matchday.findUnique({ where: { id: matchdayId } });
  if (!matchday) throw new MatchdayError('Matchday not found.');

  const target = nextPhase(matchday.phase as MatchdayPhase);
  if (!target) throw new MatchdayError('This matchday is already complete.');
  if (target === 'SIMULATION') {
    throw new MatchdayError('Run the simulation rather than advancing the phase manually.');
  }

  await prisma.matchday.update({ where: { id: matchdayId }, data: { phase: target } });

  // Reaching LOCKED is the deadline passing: every plan still outstanding is
  // committed as it stands, so no club is left unable to either edit or lock.
  if (target === 'LOCKED') {
    await lockOutstandingPlans(matchdayId, userId);
  }

  await recordAudit({
    action: 'MATCHDAY_PHASE_ADVANCED', entity: 'Matchday', entityId: matchdayId, userId,
    before: { phase: matchday.phase }, after: { phase: target },
  });
  return target;
}

export async function setPhase(matchdayId: string, phase: MatchdayPhase, userId?: string) {
  const before = await prisma.matchday.findUnique({ where: { id: matchdayId } });
  await prisma.matchday.update({ where: { id: matchdayId }, data: { phase } });
  await recordAudit({
    action: 'MATCHDAY_PHASE_SET', entity: 'Matchday', entityId: matchdayId, userId,
    before: { phase: before?.phase }, after: { phase },
  });
}

/**
 * Reopen a locked matchday. This is deliberately an administrator action: it
 * un-freezes plans that other managers have already committed against.
 */
export async function reopenMatchday(matchdayId: string, userId: string) {
  const matchday = await prisma.matchday.findUnique({
    where: { id: matchdayId },
    include: { fixtures: { include: { match: true, matchPlans: true } } },
  });
  if (!matchday) throw new MatchdayError('Matchday not found.');
  if (matchday.fixtures.some((f) => f.match)) {
    throw new MatchdayError('This matchday has already been played and cannot be reopened.');
  }

  const planIds = matchday.fixtures.flatMap((f) => f.matchPlans.map((p) => p.id));
  await prisma.$transaction([
    prisma.matchPlan.updateMany({
      where: { id: { in: planIds } },
      data: { status: 'APPROVED', lockedAt: null },
    }),
    prisma.matchday.update({ where: { id: matchdayId }, data: { phase: 'REVIEW_AND_APPROVAL' } }),
  ]);
  await recordAudit({
    action: 'MATCHDAY_REOPENED', entity: 'Matchday', entityId: matchdayId, userId,
    before: { phase: matchday.phase }, after: { phase: 'REVIEW_AND_APPROVAL' },
  });
}

export interface LockStatus {
  total: number;
  locked: number;
  outstanding: Array<{ clubId: string; clubName: string }>;
  allLocked: boolean;
}

export async function getLockStatus(matchdayId: string): Promise<LockStatus> {
  const fixtures = await prisma.fixture.findMany({
    where: { matchdayId },
    include: { homeClub: true, awayClub: true, matchPlans: true },
  });
  const entries: Array<{ clubId: string; clubName: string; locked: boolean }> = [];
  for (const fixture of fixtures) {
    for (const club of [fixture.homeClub, fixture.awayClub]) {
      const plan = fixture.matchPlans.find((p) => p.clubId === club.id);
      entries.push({ clubId: club.id, clubName: club.name, locked: plan?.status === 'LOCKED' });
    }
  }
  const locked = entries.filter((e) => e.locked);
  return {
    total: entries.length,
    locked: locked.length,
    outstanding: entries.filter((e) => !e.locked).map(({ clubId, clubName }) => ({ clubId, clubName })),
    allLocked: entries.length > 0 && locked.length === entries.length,
  };
}

export async function getFixtureForClub(matchdayId: string, clubId: string) {
  return prisma.fixture.findFirst({
    where: { matchdayId, OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
    include: { homeClub: true, awayClub: true, matchday: true, match: true },
  });
}

/** Freeze every plan that is not yet locked when the deadline arrives. */
export async function lockOutstandingPlans(matchdayId: string, userId: string): Promise<number> {
  const plans = await prisma.matchPlan.findMany({
    where: { fixture: { matchdayId }, status: { not: 'LOCKED' } },
    select: { id: true, clubId: true },
  });
  if (plans.length === 0) return 0;
  const now = new Date();
  await prisma.matchPlan.updateMany({
    where: { id: { in: plans.map((p) => p.id) } },
    data: { status: 'LOCKED', lockedAt: now },
  });
  await recordAudit({
    action: 'MATCHDAY_DEADLINE_LOCK', entity: 'Matchday', entityId: matchdayId, userId,
    after: { lockedPlans: plans.length, clubs: plans.map((p) => p.clubId) },
  });
  return plans.length;
}
