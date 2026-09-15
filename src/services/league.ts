import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { generateDoubleRoundRobin, matchdayCount } from '@/domain/generation/fixtures';
import { CLUB_SEEDS, COACH_NAMES, COACH_PERSONAS } from '@/domain/generation/names';
import { generateSquad } from '@/domain/generation/squad';
import { UNTRAINED_FAMILIARITY } from '@/domain/familiarity';
import { createRng } from '@/engine/rng';
import { recordAudit } from './audit';

/**
 * League lifecycle: creating a private league, letting friends join, and
 * building a complete fictional season for them to manage.
 */

export class LeagueError extends Error {}

function makeInviteCode(): string {
  // Human-readable, unambiguous characters only: this gets typed on a phone.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function createLeague(userId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 3) throw new LeagueError('League names must be at least 3 characters.');

  const league = await prisma.league.create({
    data: {
      name: trimmed,
      inviteCode: makeInviteCode(),
      ownerId: userId,
      memberships: { create: { userId, role: 'OWNER' } },
    },
  });
  await recordAudit({ action: 'LEAGUE_CREATED', entity: 'League', entityId: league.id, leagueId: league.id, userId, after: { name: trimmed } });
  return league;
}

export async function joinLeague(userId: string, inviteCode: string) {
  const league = await prisma.league.findUnique({
    where: { inviteCode: inviteCode.trim().toUpperCase() },
    include: { clubs: true },
  });
  if (!league) throw new LeagueError('That invite code does not match any league.');

  const existing = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId: league.id, userId } },
  });
  if (!existing) {
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId, role: 'MANAGER' } });
  }

  // Hand the new manager the first unclaimed club, if the season has started.
  const unclaimed = league.clubs.find((c) => c.ownerUserId === null);
  if (unclaimed) {
    await prisma.club.update({ where: { id: unclaimed.id }, data: { ownerUserId: userId } });
    await recordAudit({ action: 'CLUB_ASSIGNED', entity: 'Club', entityId: unclaimed.id, leagueId: league.id, clubId: unclaimed.id, userId });
  }
  await recordAudit({ action: 'LEAGUE_JOINED', entity: 'League', entityId: league.id, leagueId: league.id, userId });
  return league;
}

export interface StartSeasonOptions {
  leagueId: string;
  userId: string;
  seasonName?: string;
  clubCount?: number;
  seed?: string;
}

/**
 * Build a season: clubs, squads, coaching staff, fixtures and matchdays.
 *
 * Clubs are assigned to members in join order; any surplus clubs stay unclaimed
 * so late arrivals can still take one over.
 */
export async function startSeason(options: StartSeasonOptions) {
  const league = await prisma.league.findUnique({
    where: { id: options.leagueId },
    include: { memberships: { orderBy: { joinedAt: 'asc' } }, seasons: true, clubs: true },
  });
  if (!league) throw new LeagueError('League not found.');
  if (league.seasons.some((s) => s.status === 'ACTIVE')) {
    throw new LeagueError('This league already has an active season.');
  }

  const requested = options.clubCount ?? Math.max(6, Math.min(8, league.memberships.length));
  const clubCount = Math.max(2, Math.min(CLUB_SEEDS.length, requested));
  const seed = options.seed ?? randomBytes(6).toString('hex');
  const rng = createRng(`league:${league.id}:${seed}`);

  const seasonName = options.seasonName ?? `Season ${league.seasons.length + 1}`;

  return prisma.$transaction(async (tx) => {
    const season = await tx.season.create({
      data: { leagueId: league.id, name: seasonName, status: 'ACTIVE' },
    });

    // Clubs. Reuse existing clubs across seasons if the league already has them.
    let clubs = league.clubs;
    if (clubs.length === 0) {
      const seeds = CLUB_SEEDS.slice(0, clubCount);
      clubs = [];
      for (let i = 0; i < seeds.length; i += 1) {
        const seedClub = seeds[i];
        const owner = league.memberships[i]?.userId ?? null;
        const club = await tx.club.create({
          data: {
            leagueId: league.id,
            name: seedClub.name,
            shortName: seedClub.shortName,
            nickname: seedClub.nickname,
            stadium: seedClub.stadium,
            primaryColor: seedClub.primaryColor,
            reputation: seedClub.reputation,
            morale: 60,
            ownerUserId: owner,
          },
        });
        clubs.push(club);

        await tx.aiManager.create({
          data: {
            clubId: club.id,
            name: COACH_NAMES[i % COACH_NAMES.length],
            persona: COACH_PERSONAS[i % COACH_PERSONAS.length],
            philosophy: seedClub.identity,
          },
        });

        // Squad.
        const players = generateSquad({ seed: `${seed}:${club.id}`, clubReputation: seedClub.reputation });
        for (const player of players) {
          const created = await tx.player.create({
            data: {
              clubId: club.id,
              firstName: player.firstName,
              lastName: player.lastName,
              age: player.age,
              shirtNumber: player.shirtNumber,
              primaryPosition: player.primaryPosition,
              secondaryPositions: player.secondaryPositions,
              preferredFoot: player.preferredFoot,
              potential: player.potential,
              personality: player.personality,
              contractUntil: player.contractUntil,
              wageThousands: player.wageThousands,
            },
          });
          await tx.playerAttribute.create({ data: { playerId: created.id, ...player.attributes } });
          await tx.playerState.create({
            data: {
              playerId: created.id,
              fitness: player.fitness,
              morale: player.morale,
              form: player.form,
              confidence: 55,
              matchSharpness: player.matchSharpness,
            },
          });
        }

        // A new club knows a little about its stated identity and not much else.
        await tx.tacticalFamiliarity.createMany({
          data: [
            { clubId: club.id, dimension: 'TRANSITION', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 8) },
            { clubId: club.id, dimension: 'SET_PIECES', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 8) },
            { clubId: club.id, dimension: 'OVERALL_STABILITY', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 10) },
            { clubId: club.id, dimension: 'FORMATION', key: 'F_4_3_3', value: UNTRAINED_FAMILIARITY + rng.int(5, 20) },
            { clubId: club.id, dimension: 'PLAYING_STYLE', key: 'BALANCED', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
            { clubId: club.id, dimension: 'PRESSING', key: 'MEDIUM', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
            { clubId: club.id, dimension: 'DEFENSIVE_ORGANISATION', key: 'MID_BLOCK', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
            { clubId: club.id, dimension: 'BUILD_UP', key: 'MIXED', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
          ],
        });
      }
    }

    // Matchdays and fixtures.
    const totalMatchdays = matchdayCount(clubs.length);
    const matchdays = [];
    for (let number = 1; number <= totalMatchdays; number += 1) {
      matchdays.push(await tx.matchday.create({
        data: {
          seasonId: season.id,
          number,
          phase: 'OPEN',
          deadlineAt: new Date(Date.now() + number * 7 * 24 * 60 * 60 * 1000),
        },
      }));
    }

    const schedule = generateDoubleRoundRobin(clubs.length);
    for (const fixture of schedule) {
      const matchday = matchdays[fixture.matchdayNumber - 1];
      if (!matchday) continue;
      await tx.fixture.create({
        data: {
          seasonId: season.id,
          matchdayId: matchday.id,
          homeClubId: clubs[fixture.homeIndex].id,
          awayClubId: clubs[fixture.awayIndex].id,
        },
      });
    }

    return { season, clubs, matchdays: matchdays.length };
  }, { timeout: 120_000, maxWait: 20_000 });
}

export async function getLeagueForUser(userId: string) {
  return prisma.league.findFirst({
    where: { memberships: { some: { userId } } },
    include: {
      memberships: { include: { user: true } },
      clubs: { orderBy: { name: 'asc' } },
      seasons: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function assignClub(leagueId: string, clubId: string, userId: string | null) {
  await prisma.club.update({ where: { id: clubId }, data: { ownerUserId: userId } });
  await recordAudit({ action: 'CLUB_ASSIGNED', entity: 'Club', entityId: clubId, leagueId, clubId, userId: userId ?? undefined });
}
