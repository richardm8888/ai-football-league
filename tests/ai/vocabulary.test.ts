import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCoachContext } from '@/ai/context';
import { proposeLocally, readIntent } from '@/ai/providers/local';
import { validateProposal } from '@/ai/coach';
import { advertisedExamples, COACH_OPENERS, COACH_TOPICS, OPPONENT_NOTE } from '@/ai/vocabulary';
import { coachProposalSchema } from '@/domain/schemas';
import { clubOf, createTestLeague, type TestLeague } from '../helpers/league';

/**
 * The guidance and the parser, held together.
 *
 * Telling a manager "you can ask for this" is a promise. The coach screen makes
 * that promise from `COACH_TOPICS`, and the local coach keeps it from a fixed
 * set of intents — two lists that can drift apart silently, leaving the
 * interface teaching phrasings the staff shrug at. These tests fail when they
 * do: every advertised phrase must still register as an instruction and still
 * produce a proposal the domain accepts.
 */

const prisma = new PrismaClient();
let league: TestLeague;
let clubId: string;

beforeAll(async () => {
  league = await createTestLeague(prisma, { seed: 'vocabulary-tests' });
  clubId = clubOf(league, league.ownerId).id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('every advertised example still works', () => {
  it('registers as an instruction rather than falling through as vague', () => {
    // A vague message gets a continuity plan and a clarifying question, which
    // is the right answer to "ok" and the wrong answer to something the screen
    // told the manager to say.
    const ignored = advertisedExamples().filter((example) => readIntent(example).vague);
    expect(ignored).toEqual([]);
  });

  it('produces a proposal the domain accepts', async () => {
    const context = await buildCoachContext(clubId);
    for (const example of advertisedExamples()) {
      const proposal = proposeLocally({ message: example, history: [], context, memories: [] });
      expect(coachProposalSchema.safeParse(proposal).success, example).toBe(true);

      const validated = await validateProposal(clubId, proposal, context);
      const errors = [
        ...(validated.tactics?.errors ?? []),
        ...(validated.lineupValidation?.errors ?? []),
        ...(validated.trainingValidation?.errors ?? []),
      ].map((issue) => issue.message);
      expect(errors, example).toEqual([]);
    }
  }, 60_000);

  it('offers one opener per topic, drawn from the topics themselves', () => {
    expect(COACH_OPENERS).toHaveLength(COACH_TOPICS.length);
    for (const opener of COACH_OPENERS) {
      expect(advertisedExamples()).toContain(opener);
    }
  });

  it('gives every topic something to show', () => {
    for (const topic of COACH_TOPICS) {
      expect(topic.examples.length, topic.id).toBeGreaterThan(0);
      expect(topic.what.length, topic.id).toBeGreaterThan(0);
    }
  });
});

describe('the opponent note describes what actually happens', () => {
  it('reads a clause about the opposition as context, not as an instruction', async () => {
    const context = await buildCoachContext(clubId);
    const described = proposeLocally({
      message: 'They press aggressively and play a high line.',
      history: [], context, memories: [],
    });
    // The note on the coach screen promises exactly this: talking about them
    // does not ask your own side to do it.
    expect(described.tactics?.pressing).not.toBe('INTENSE');
    expect(described.tactics?.defensiveLine).not.toBe('HIGH');
  });

  it('acts on the rewrite the note suggests', () => {
    expect(readIntent(OPPONENT_NOTE.example).playAroundPress).toBe(true);
  });
});

describe('instructions about the week on the training ground', () => {
  it('works on what the manager named rather than the weakest area', async () => {
    const context = await buildCoachContext(clubId);
    const proposal = proposeLocally({
      message: 'Work on playing out from the back.', history: [], context, memories: [],
    });
    expect(proposal.training?.primaryFocus).toBe('POSSESSION');
  });

  it('honours a light week even when the squad is fresh enough for a hard one', async () => {
    const context = await buildCoachContext(clubId);
    const light = proposeLocally({
      message: 'Keep training light this week, legs looked heavy.',
      history: [], context, memories: [],
    });
    expect(light.training?.intensity).toBe('LIGHT');
    expect(light.training?.secondaryFocus).toBe('RECOVERY');
  });

  it('works the squad hard when asked, and says what that costs', async () => {
    const context = await buildCoachContext(clubId);
    const hard = proposeLocally({
      message: 'Work them hard this week, we need the fitness.',
      history: [], context, memories: [],
    });
    expect(['NORMAL', 'HIGH']).toContain(hard.training?.intensity);
    if (hard.training?.intensity === 'HIGH') {
      expect(hard.risks.join(' ')).toMatch(/hard week/i);
    }
  });
});
