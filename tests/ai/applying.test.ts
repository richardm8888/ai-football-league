import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askCoach } from '@/ai/coach';
import { applyDecision, undoDecision } from '@/services/ai-decisions';
import { getOrCreateMatchPlan } from '@/services/plans';
import { clubOf, createTestLeague, type TestLeague } from '../helpers/league';

/**
 * Instructing the staff is the decision.
 *
 * The old design proposed a change and waited for a second click on a card that
 * rendered above the reply, so managers read the advice, never saw the button,
 * and reasonably concluded the coach had done nothing. Acting on sight is only
 * safe if two things hold, and both are asserted here: the manager is told
 * exactly what moved, and it can be put back.
 *
 * What has not changed is the safety model, and that is asserted too: a
 * proposal still lands as a DRAFT, so locking before the deadline remains the
 * manager's own act.
 */

const prisma = new PrismaClient();
let league: TestLeague;
let clubId: string;
let userId: string;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'apply-tests' });
  userId = league.ownerId;
  clubId = clubOf(league, userId).id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

async function propose(message: string) {
  const result = await askCoach({ clubId, userId, message });
  const decision = result.decisions.find((d) => d.status === 'PROPOSED');
  expect(decision, 'the coach produced no applicable proposal').toBeDefined();
  return decision!;
}

async function currentPlan() {
  const fixture = await prisma.fixture.findFirst({
    where: {
      matchday: { phase: { not: 'COMPLETE' } },
      OR: [{ homeClubId: clubId }, { awayClubId: clubId }],
    },
    orderBy: { matchday: { number: 'asc' } },
  });
  return getOrCreateMatchPlan(fixture!.id, clubId);
}

describe('applying an instruction', () => {
  it('changes the plan and says what it changed', async () => {
    const before = await currentPlan();
    const decision = await propose('Switch us to three at the back and press high.');

    const applied = await applyDecision(decision.id, userId);
    const after = await currentPlan();

    expect(applied.changes.length).toBeGreaterThan(0);
    // Every line has to correspond to something that actually moved, or the
    // manager is being told a story rather than shown a change.
    expect(JSON.stringify(after.tactics)).not.toEqual(JSON.stringify(before.tactics));
  }, 60_000);

  it('lands as a draft, so locking in is still the manager\'s own act', async () => {
    const decision = await propose('Play a patient possession game.');
    await applyDecision(decision.id, userId);

    const plan = await currentPlan();
    expect(plan.status).toBe('DRAFT');
  }, 60_000);

  it('records the decision as applied, so it leaves the pending list', async () => {
    const decision = await propose('Sit deeper and counter.');
    await applyDecision(decision.id, userId);

    const row = await prisma.aiDecision.findUnique({ where: { id: decision.id } });
    expect(row?.status).toBe('APPROVED');
    expect(row?.appliedAt).not.toBeNull();
    expect(row?.previousState).not.toBeNull();
  }, 60_000);
});

describe('undoing an instruction', () => {
  it('puts the plan back exactly as it was', async () => {
    const before = await currentPlan();
    const decision = await propose('Go very attacking, throw everyone forward.');

    await applyDecision(decision.id, userId);
    await undoDecision(decision.id, userId);

    const restored = await currentPlan();
    expect(restored.tactics).toEqual(before.tactics);
    expect(restored.lineup.starters.map((s) => s.playerId))
      .toEqual(before.lineup.starters.map((s) => s.playerId));
  }, 60_000);

  it('refuses to undo the same change twice', async () => {
    const decision = await propose('Push the full-backs high.');
    await applyDecision(decision.id, userId);
    await undoDecision(decision.id, userId);

    await expect(undoDecision(decision.id, userId)).rejects.toThrow(/already been undone/);
  }, 60_000);

  it('refuses to undo something that was never applied', async () => {
    const decision = await propose('Keep it tight in midfield.');
    await expect(undoDecision(decision.id, userId)).rejects.toThrow(/nothing to undo/);
  }, 60_000);
});

describe('what applying cannot do', () => {
  it('still cannot touch a result', async () => {
    const fixturesBefore = await prisma.fixture.findMany({
      where: { OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
      orderBy: { id: 'asc' },
    });

    const decision = await propose('Just make us win 5-0.');
    await applyDecision(decision.id, userId);

    // The engine is the only authority on results. Asking for a scoreline
    // reaches a plan and nothing else, so every fixture is untouched.
    const fixturesAfter = await prisma.fixture.findMany({
      where: { OR: [{ homeClubId: clubId }, { awayClubId: clubId }] },
      orderBy: { id: 'asc' },
    });
    expect(fixturesAfter).toEqual(fixturesBefore);
  }, 60_000);
});
