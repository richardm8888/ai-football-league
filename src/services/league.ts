import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { generateDoubleRoundRobin, matchdayCount } from '@/domain/generation/fixtures';
import { buildTable, type PlayedFixture } from '@/domain/league/standings';
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

  // No club is handed out here. Which club you take is a decision worth making
  // on what every manager can see about them, so it belongs to the manager.
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

/**
 * Rewind a league to day one, keeping the clubs it already has.
 *
 * An interim testing tool, not a game mechanic: it lets a group replay the
 * opening week as many times as it takes to get the flow right. The clubs,
 * squads and fixture list survive, so a run can be compared against the one
 * before it; everything the league went on to do is removed.
 *
 * Club ownership is cleared too. Choosing a club is part of the starting flow,
 * so a reset that left everyone holding the club they picked last time could
 * not be used to test it.
 *
 * Starting condition is re-derived per player rather than restored from a
 * snapshot, seeded on the player's own id: reproducible for a given squad, and
 * varied in the same way generation makes it, so week one is not uniformly
 * perfect.
 */
export async function resetSeason(leagueId: string, userId: string) {
  const season = await prisma.season.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    include: { matchdays: { orderBy: { number: 'asc' } } },
  });
  if (!season) throw new LeagueError('This league has no season to reset.');

  const clubs = await prisma.club.findMany({ where: { leagueId }, select: { id: true } });
  const clubIds = clubs.map((c) => c.id);
  const players = await prisma.player.findMany({
    where: { clubId: { in: clubIds } }, select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    // Everything the league did. Matches cascade to events, statistics and
    // performances; match plans cascade to their tactics and line-ups.
    await tx.match.deleteMany({ where: { fixture: { seasonId: season.id } } });
    await tx.matchPlan.deleteMany({ where: { fixture: { seasonId: season.id } } });
    await tx.trainingPlan.deleteMany({ where: { clubId: { in: clubIds } } });
    await tx.report.deleteMany({ where: { seasonId: season.id } });
    await tx.clubHistory.deleteMany({ where: { seasonId: season.id } });

    // Everything the coaching staff remembers.
    await tx.aiDecision.deleteMany({ where: { clubId: { in: clubIds } } });
    await tx.aiMemory.deleteMany({ where: { clubId: { in: clubIds } } });
    await tx.aiConversation.deleteMany({ where: { clubId: { in: clubIds } } });

    // Everything the squads learned.
    await tx.playerFamiliarity.deleteMany({ where: { player: { clubId: { in: clubIds } } } });
    await tx.tacticalFamiliarity.deleteMany({ where: { clubId: { in: clubIds } } });
    for (const clubId of clubIds) {
      const rng = createRng(`reset:${clubId}`);
      await tx.tacticalFamiliarity.createMany({
        data: [
          { clubId, dimension: 'TRANSITION', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 8) },
          { clubId, dimension: 'SET_PIECES', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 8) },
          { clubId, dimension: 'OVERALL_STABILITY', key: '_', value: UNTRAINED_FAMILIARITY + rng.int(0, 10) },
          { clubId, dimension: 'FORMATION', key: 'F_4_3_3', value: UNTRAINED_FAMILIARITY + rng.int(5, 20) },
          { clubId, dimension: 'PLAYING_STYLE', key: 'BALANCED', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
          { clubId, dimension: 'PRESSING', key: 'MEDIUM', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
          { clubId, dimension: 'DEFENSIVE_ORGANISATION', key: 'MID_BLOCK', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
          { clubId, dimension: 'BUILD_UP', key: 'MIXED', value: UNTRAINED_FAMILIARITY + rng.int(5, 18) },
        ],
      });
    }

    // Every player back to a fresh pre-season condition.
    for (const player of players) {
      const rng = createRng(`reset:${player.id}`);
      await tx.playerState.update({
        where: { playerId: player.id },
        data: {
          fitness: rng.int(88, 100),
          fatigue: 0,
          morale: rng.int(48, 78),
          form: rng.int(40, 62),
          confidence: 55,
          matchSharpness: rng.int(45, 70),
          injury: 'NONE',
          injuryDescription: null,
          injuryWeeksLeft: 0,
          suspensionMatches: 0,
          yellowCardsSeason: 0,
          redCardsSeason: 0,
          appearances: 0,
          goals: 0,
          assists: 0,
          minutes: 0,
          ratingSum: 0,
        },
      });
    }

    // The calendar, back to an unplayed matchday one.
    await tx.fixture.updateMany({
      where: { seasonId: season.id },
      data: { status: 'SCHEDULED' },
    });
    await tx.matchday.updateMany({
      where: { seasonId: season.id },
      data: { phase: 'OPEN', simulatedAt: null },
    });
    await tx.season.update({ where: { id: season.id }, data: { status: 'ACTIVE' } });

    // Clubs go back on the shelf so the joining flow can be walked again.
    await tx.club.updateMany({
      where: { leagueId },
      data: { ownerUserId: null, morale: 60 },
    });
  }, { timeout: 120_000 });

  await recordAudit({
    action: 'LEAGUE_RESET', entity: 'League', entityId: leagueId, leagueId, userId,
    after: { seasonId: season.id, clubs: clubIds.length, players: players.length },
  });
  return season;
}

/**
 * The clubs on offer, described only by what every manager can already see.
 *
 * Choosing a club is a real decision, so it needs real information: what the
 * club is known for, how well thought of it is, and how it is actually doing.
 * Deliberately nothing else. A squad list here would hand whoever picks last a
 * scouting report on everyone else, which is the one thing the game is built
 * not to allow.
 *
 * Clubs already taken are returned too, marked unavailable: you are choosing a
 * club in a league, and which of them are spoken for is part of the picture.
 */
export interface ClubChoice {
  id: string;
  name: string;
  nickname: string | null;
  stadium: string | null;
  primaryColor: string;
  reputation: number;
  /** The club's stated style of play, which it is publicly known for. */
  identity: string;
  position: number | null;
  played: number;
  points: number;
  formGuide: string;
  available: boolean;
}

export async function listClubChoices(leagueId: string): Promise<ClubChoice[]> {
  const clubs = await prisma.club.findMany({
    where: { leagueId },
    include: { aiManager: true },
    orderBy: { name: 'asc' },
  });
  if (clubs.length === 0) return [];

  const season = await prisma.season.findFirst({
    where: { leagueId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });

  const played: PlayedFixture[] = season
    ? (await prisma.fixture.findMany({
      where: { seasonId: season.id, match: { isNot: null } },
      include: { match: true, matchday: true },
    })).map((f) => ({
      matchdayNumber: f.matchday.number,
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      homeGoals: f.match!.homeGoals,
      awayGoals: f.match!.awayGoals,
    }))
    : [];

  const table = buildTable(clubs.map((c) => c.id), played);

  return clubs.map((club) => {
    const row = table.find((r) => r.clubId === club.id);
    return {
      id: club.id,
      name: club.name,
      nickname: club.nickname,
      stadium: club.stadium,
      primaryColor: club.primaryColor,
      reputation: club.reputation,
      identity: club.aiManager?.philosophy ?? '',
      // Before a ball is kicked every club sits on nought points, so a league
      // position would be an artefact of the sort order rather than a fact.
      position: played.length > 0 && row ? row.position : null,
      played: row?.played ?? 0,
      points: row?.points ?? 0,
      formGuide: row?.formGuide ?? '',
      available: club.ownerUserId === null,
    };
  });
}

/** Take an unclaimed club. One club per manager per league. */
export async function claimClub(leagueId: string, clubId: string, userId: string) {
  const membership = await prisma.leagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
  });
  if (!membership) throw new LeagueError('You are not a member of this league.');

  const existing = await prisma.club.findFirst({ where: { leagueId, ownerUserId: userId } });
  if (existing) throw new LeagueError(`You already manage ${existing.name}.`);

  const club = await prisma.club.findFirst({ where: { id: clubId, leagueId } });
  if (!club) throw new LeagueError('That club is not in this league.');
  if (club.ownerUserId) throw new LeagueError(`${club.name} has already been taken.`);

  // Claim it only if it is still free when the write lands: two managers can
  // be looking at the same list at the same time, and the loser of that race
  // should be told rather than quietly made a co-owner.
  const claimed = await prisma.club.updateMany({
    where: { id: clubId, leagueId, ownerUserId: null },
    data: { ownerUserId: userId },
  });
  if (claimed.count === 0) throw new LeagueError(`${club.name} has just been taken by someone else.`);

  await recordAudit({
    action: 'CLUB_CLAIMED', entity: 'Club', entityId: clubId, leagueId, clubId, userId,
  });
  return club;
}
