import type Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clubOf, createTestLeague, type TestLeague } from '../helpers/league';

/**
 * What a coaching request cost, as recorded.
 *
 * Nothing logged token usage before, so the cost of running a league was
 * derived from the code rather than observed. The one thing that has to hold
 * for those records to be worth anything is that the tokens are counted once:
 * a single call can propose tactics, training and a scouting summary at once,
 * and writing the same counters onto all three rows would make every later sum
 * a multiple of the real spend.
 *
 * The SDK is replaced wholesale here so askCoach can be driven down the
 * Anthropic path without a key or a network call.
 */

const reply = { usage: {} as Partial<Anthropic.Usage>, proposal: {} as unknown };

vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
  class StubAnthropic {
    static APIError = actual.default.APIError;
    messages = {
      create: async () => ({
        content: [{ type: 'tool_use', name: 'propose_plan', input: reply.proposal }],
        usage: { input_tokens: 0, output_tokens: 0, ...reply.usage },
      }),
    };
  }
  return { ...actual, default: StubAnthropic };
});

const prisma = new PrismaClient();
let league: TestLeague;
let clubId: string;
let userId: string;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'ai-usage' });
  userId = league.ownerId;
  clubId = clubOf(league, userId).id;
  process.env.AI_PROVIDER = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'test-key';
}, 120_000);

afterAll(async () => {
  process.env.AI_PROVIDER = 'local';
  delete process.env.ANTHROPIC_API_KEY;
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.aiDecision.deleteMany({ where: { clubId } });
});

describe('token usage on a logged proposal', () => {
  it('counts one call once, however many proposals it produced', async () => {
    const { askCoach } = await import('@/ai/coach');
    const { proposeLocally } = await import('@/ai/providers/local');
    const { buildCoachContext } = await import('@/ai/context');

    const context = await buildCoachContext(clubId);
    const message = 'Switch us to a back three and train the shape so we are not learning it on matchday.';
    reply.proposal = proposeLocally({ message, history: [], context, memories: [] });
    reply.usage = {
      input_tokens: 4200,
      output_tokens: 640,
      cache_creation_input_tokens: 1747,
      cache_read_input_tokens: 0,
    };

    const turn = await askCoach({ clubId, userId, message });
    expect(turn.decisions.length).toBeGreaterThan(1);

    const rows = await prisma.aiDecision.findMany({
      where: { clubId }, orderBy: { createdAt: 'asc' },
    });
    const counted = rows.filter((r) => r.inputTokens !== null);
    expect(counted).toHaveLength(1);
    expect(counted[0]).toMatchObject({
      inputTokens: 4200,
      outputTokens: 640,
      cacheCreationInputTokens: 1747,
      cacheReadInputTokens: 0,
    });

    // The point of recording it once: a sum over the rows is the real spend.
    const total = rows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
    expect(total).toBe(4200);

    // Every row still carries the rest of what the call reported.
    for (const row of rows) expect(row.provider).toBe('anthropic');
  });

  it('leaves the counters null when no API call was made', async () => {
    const { askCoach } = await import('@/ai/coach');
    process.env.AI_PROVIDER = 'local';
    try {
      await askCoach({
        clubId, userId,
        message: 'Press higher this week and work on the shape in training.',
      });
    } finally {
      process.env.AI_PROVIDER = 'anthropic';
    }

    const rows = await prisma.aiDecision.findMany({ where: { clubId } });
    expect(rows.length).toBeGreaterThan(0);
    // Null, not zero: the local coach spent no tokens because it made no call,
    // and averaging that in as zero would understate the real cost of a league.
    for (const row of rows) {
      expect(row.provider).toBe('local');
      expect(row.inputTokens).toBeNull();
      expect(row.cacheReadInputTokens).toBeNull();
    }
  });
});
