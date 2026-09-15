/**
 * What the coaching staff actually understand, in a manager's own words.
 *
 * This is the source for the guidance on the coach screen and for the examples
 * offered on the tactics and training screens. It lives in the AI layer rather
 * than in the components on purpose: the local coach reads a fixed set of
 * intents, and guidance written separately from that set drifts into teaching
 * managers phrasings the staff will not recognise. `tests/ai/vocabulary.test.ts`
 * puts every example below through the coach and fails if one stops landing.
 *
 * Plain data with no imports, so a client component can render it.
 */

export interface CoachTopic {
  id: string;
  /** What this group of instructions affects. */
  title: string;
  what: string;
  examples: string[];
}

export const COACH_TOPICS: CoachTopic[] = [
  {
    id: 'shape',
    title: 'Shape and style',
    what: 'The formation, how you want to move the ball, and how quickly.',
    examples: [
      'I want us to keep the ball and control the game.',
      'Get it forward early and go direct.',
      'Sit deeper and break on the counter.',
      'Be patient and take our time building.',
      'Use the width and get crosses in.',
    ],
  },
  {
    id: 'defending',
    title: 'Pressing and defending',
    what: 'How high the side starts its defending, and what it refuses to risk.',
    examples: [
      'Press high and win the ball back quickly.',
      'Drop into a low block and see the game out.',
      'Protect the centre of the pitch, we are outnumbered in there.',
      'Do not leave us open in transition.',
    ],
  },
  {
    id: 'in-match',
    title: 'Responding to the score',
    what: 'Standing instructions for how the side should change as the match turns.',
    examples: [
      'Start cautiously and open up after the hour.',
      'Chase the game if we go a goal down.',
    ],
  },
  {
    id: 'selection',
    title: 'Selection and rotation',
    what: 'Who plays, who is rested, and how hard you are leaning on the same eleven.',
    examples: [
      'Rest anyone who is tired and pick the freshest side.',
      'Rotate this week, we have a lot of games coming.',
    ],
  },
  {
    id: 'training',
    title: 'The week on the training ground',
    what: 'What the side rehearses before the match, and how hard it is worked.',
    examples: [
      'Work on playing out from the back.',
      'Keep training light this week, legs looked heavy.',
      'Work them hard this week, we need the fitness.',
      'Work on our corners and free kicks.',
    ],
  },
];

/**
 * The one behaviour nobody guesses.
 *
 * Clauses about the opposition are stripped before intent is read
 * (`OPPONENT_CLAUSE` in `providers/local.ts`), so "they press aggressively" is
 * heard as a fact about them rather than as a request for your side to press.
 * A manager who does not know that gets the opposite of what they expected.
 */
export const OPPONENT_NOTE = {
  title: 'Talking about the opposition',
  body: 'Anything you say about them is read as context, not as an instruction. '
    + '"They press aggressively" tells your staff what to expect from the opposition; '
    + 'it does not ask your own side to press. Say what you want your side to do.',
  example: 'Play around their press rather than forcing it short.',
};

/** The one-tap openers on the coach composer: the first example of each topic. */
export const COACH_OPENERS: string[] = COACH_TOPICS.map((topic) => topic.examples[0]);

/** The first few examples of one topic, for a screen that covers only part of this. */
export function topicExamples(id: string, count = 3): string[] {
  return (COACH_TOPICS.find((topic) => topic.id === id)?.examples ?? []).slice(0, count);
}

/** Every phrase advertised anywhere in the interface. */
export function advertisedExamples(): string[] {
  return [...COACH_TOPICS.flatMap((topic) => topic.examples), OPPONENT_NOTE.example];
}
