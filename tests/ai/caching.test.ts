import type Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCoachContext } from '@/ai/context';
import { AnthropicCoachProvider } from '@/ai/providers/anthropic';
import { proposeLocally } from '@/ai/providers/local';
import type { CoachRequest } from '@/ai/provider';
import { clubOf, createTestLeague, type TestLeague } from '../helpers/league';

/**
 * What the Anthropic provider puts on the wire.
 *
 * Prompt caching fails silently. A prefix that stops matching, or a breakpoint
 * that goes missing in a refactor, raises nothing at all — the requests keep
 * succeeding and the bill quietly goes back up. These assertions are the only
 * thing standing between a working cache and paying full price without knowing
 * it, because the real confirmation, a non-zero cache read, needs an API key
 * and a second request within five minutes.
 *
 * No request leaves the machine: the SDK call is replaced with one that records
 * what it was handed.
 */

const prisma = new PrismaClient();
let league: TestLeague;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'ai-caching' });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

type Body = Anthropic.MessageCreateParamsNonStreaming;

/** Replace the SDK call with one that records the request and returns a proposal. */
function capture(
  provider: AnthropicCoachProvider,
  request: CoachRequest,
  usage: Partial<Anthropic.Usage> = {},
): Body[] {
  const bodies: Body[] = [];
  const reply = {
    content: [{ type: 'tool_use', name: 'propose_plan', input: proposeLocally(request) }],
    usage: { input_tokens: 0, output_tokens: 0, ...usage },
  };
  (provider as unknown as {
    client: { messages: { create: (body: Body) => Promise<unknown> } };
  }).client.messages.create = async (body: Body) => {
    bodies.push(body);
    return reply;
  };
  return bodies;
}

async function requestFor(clubId: string): Promise<CoachRequest> {
  return {
    message: 'Press higher and get the ball forward quicker.',
    history: [],
    context: await buildCoachContext(clubId),
    memories: [],
  };
}

describe('the cached static prefix', () => {
  it('marks both the tool schema and the system prompt, at five minutes', async () => {
    const provider = new AnthropicCoachProvider('test-key');
    const request = await requestFor(clubOf(league, league.ownerId).id);
    const bodies = capture(provider, request);
    await provider.propose(request);

    const [body] = bodies;
    expect(bodies).toHaveLength(1);

    // The tool schema is the larger half of the prefix and gets its own
    // breakpoint, so editing the system prompt does not discard it too.
    expect(body.tools?.[0]).toMatchObject({
      name: 'propose_plan',
      cache_control: { type: 'ephemeral', ttl: '5m' },
    });

    // A bare string cannot carry a breakpoint, so the system prompt has to go
    // as blocks. Tools render before system, so this one covers both.
    expect(Array.isArray(body.system)).toBe(true);
    const blocks = body.system as Anthropic.TextBlockParam[];
    expect(blocks.at(-1)?.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });

    // Five minutes, not an hour: the hourly write costs twice as much and needs
    // three reads to repay itself, which this traffic will not reliably give.
    const ttls = JSON.stringify(body).match(/"ttl":"[^"]+"/g) ?? [];
    expect(ttls).toEqual(['"ttl":"5m"', '"ttl":"5m"']);
  });

  it('is identical for every club, so one manager warms the cache for all of them', async () => {
    const clubs = league.clubs.filter((c) => c.ownerUserId).slice(0, 2);
    expect(clubs).toHaveLength(2);

    const prefixes: string[] = [];
    for (const club of clubs) {
      const provider = new AnthropicCoachProvider('test-key');
      const request = await requestFor(club.id);
      const bodies = capture(provider, request);
      await provider.propose(request);
      prefixes.push(JSON.stringify({ tools: bodies[0].tools, system: bodies[0].system }));
    }

    // Nothing club-specific may reach the prefix. The saving depends on it, and
    // so does the fairness property that every manager gets the same staff.
    expect(prefixes[0]).toEqual(prefixes[1]);
    expect(prefixes[0]).not.toContain(clubs[0].name);
  });

  it('puts the club and the squad after the breakpoint, where they belong', async () => {
    const club = clubOf(league, league.ownerId);
    const provider = new AnthropicCoachProvider('test-key');
    const request = await requestFor(club.id);
    const bodies = capture(provider, request);
    await provider.propose(request);

    // The volatile payload — squad, table, scouting, the manager's words — is
    // unique per request and belongs in the messages, not in the cached prefix.
    expect(JSON.stringify(bodies[0].messages)).toContain(club.name);
  });
});

describe('measured usage', () => {
  it('records the four counters the provider reports', async () => {
    const provider = new AnthropicCoachProvider('test-key');
    const request = await requestFor(clubOf(league, league.ownerId).id);
    capture(provider, request, {
      input_tokens: 4200,
      output_tokens: 640,
      cache_creation_input_tokens: 1747,
      cache_read_input_tokens: 0,
    });

    const result = await provider.propose(request);
    expect(result.usage).toEqual({
      inputTokens: 4200,
      outputTokens: 640,
      cacheCreationInputTokens: 1747,
      cacheReadInputTokens: 0,
    });
  });

  it('reads an absent cache counter as nothing cached, not as missing', async () => {
    const provider = new AnthropicCoachProvider('test-key');
    const request = await requestFor(clubOf(league, league.ownerId).id);
    // The API returns null rather than zero when a request cached nothing.
    capture(provider, request, {
      input_tokens: 8965,
      output_tokens: 631,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });

    const result = await provider.propose(request);
    expect(result.usage).toMatchObject({
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});
