/**
 * Seeds a complete, playable private league.
 *
 * Creates eight managers, a league, a full season of fictional clubs, squads and
 * fixtures, and optionally plays a few matchdays so there is history to study on
 * the very first visit.
 *
 *   npm run db:seed                 # league ready at matchday 1
 *   SEED_MATCHDAYS=3 npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/services/auth';
import { createLeague, startSeason } from '../src/services/league';
import { getOrCreateMatchPlan, getOrCreateTrainingPlan, lockMatchPlan } from '../src/services/plans';
import { openNextMatchday, simulateMatchday } from '../src/services/simulation';
import { setPhase } from '../src/services/matchday';

const prisma = new PrismaClient();

const MANAGERS = [
  { email: 'alex@example.com', displayName: 'Alex' },
  { email: 'bex@example.com', displayName: 'Bex' },
  { email: 'chris@example.com', displayName: 'Chris' },
  { email: 'dee@example.com', displayName: 'Dee' },
  { email: 'eli@example.com', displayName: 'Eli' },
  { email: 'fran@example.com', displayName: 'Fran' },
  { email: 'gus@example.com', displayName: 'Gus' },
  { email: 'hana@example.com', displayName: 'Hana' },
];

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'kickoff-2026';

async function main() {
  const existing = await prisma.league.findFirst();
  if (existing && process.env.SEED_FORCE !== '1') {
    console.log(`A league already exists (${existing.name}). Set SEED_FORCE=1 to seed anyway.`);
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = [];
  for (const [index, manager] of MANAGERS.entries()) {
    users.push(await prisma.user.upsert({
      where: { email: manager.email },
      create: { ...manager, passwordHash, isSuperAdmin: index === 0 },
      update: {},
    }));
  }

  const league = await createLeague(users[0].id, 'The Sunday Circle');
  for (const user of users.slice(1)) {
    await prisma.leagueMembership.create({
      data: { leagueId: league.id, userId: user.id, role: 'MANAGER' },
    });
  }

  console.log('Building the season…');
  const { season, clubs, matchdays } = await startSeason({
    leagueId: league.id, userId: users[0].id, seed: 'sunday-circle',
  });
  console.log(`  ${clubs.length} clubs, ${matchdays} matchdays.`);

  const toPlay = Number(process.env.SEED_MATCHDAYS ?? 0);
  for (let i = 0; i < toPlay; i += 1) {
    const matchday = await prisma.matchday.findFirst({
      where: { seasonId: season.id, phase: { not: 'COMPLETE' } },
      orderBy: { number: 'asc' },
      include: { fixtures: true },
    });
    if (!matchday) break;

    // Every club takes the default plan its coaching staff would suggest.
    for (const fixture of matchday.fixtures) {
      for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
        await getOrCreateMatchPlan(fixture.id, clubId);
        await getOrCreateTrainingPlan(clubId, matchday.id);
      }
    }
    await setPhase(matchday.id, 'TACTICAL_SUBMISSION', users[0].id);
    for (const fixture of matchday.fixtures) {
      for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
        await lockMatchPlan(fixture.id, clubId, users[0].id, 'TACTICAL_SUBMISSION');
      }
    }
    await setPhase(matchday.id, 'LOCKED', users[0].id);
    const summary = await simulateMatchday(matchday.id, users[0].id);
    console.log(`  Matchday ${summary.matchdayNumber}: ` +
      summary.matches.map((m) => `${m.homeClub} ${m.homeGoals}-${m.awayGoals} ${m.awayClub}`).join(' | '));
    if (i < toPlay - 1) await openNextMatchday(matchday.id, users[0].id);
  }

  console.log('\nSeeded. Sign in with any of:');
  for (const manager of MANAGERS) console.log(`  ${manager.email} / ${DEMO_PASSWORD}`);
  console.log(`\nInvite code: ${league.inviteCode}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
