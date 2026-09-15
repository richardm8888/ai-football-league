'use client';

import { COACH_TOPICS, OPPONENT_NOTE } from '@/ai/vocabulary';
import { Disclosure } from './ui';

/**
 * What you can actually ask for.
 *
 * The composer is a blank text box, and a manager's first question is not "how
 * do I phrase this" but "what does it even do". Five suggested openers hint at
 * that; they do not answer it. This lists the range, grouped by what each kind
 * of instruction affects, and stays one tap away for the whole conversation
 * rather than only at the start.
 *
 * Tapping an example loads it into the composer: tap to select, like every
 * other choice in this interface, and a starting point the manager then edits
 * in their own words.
 */
export function CoachGuide({ onUse }: { onUse: (example: string) => void }) {
  return (
    <Disclosure label="What you can ask for" tone="brand">
      <div className="space-y-4">
        {COACH_TOPICS.map((topic) => (
          <section key={topic.id}>
            <h3 className="text-sm font-semibold text-ink-50">{topic.title}</h3>
            <p className="mt-0.5 text-xs text-ink-400">{topic.what}</p>
            <ul className="mt-2 space-y-1.5">
              {topic.examples.map((example) => (
                <li key={example}>
                  <ExampleButton example={example} onUse={onUse} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="rounded-xl border border-warn-500/40 bg-warn-500/10 p-3">
          <h3 className="text-sm font-semibold text-warn-400">{OPPONENT_NOTE.title}</h3>
          <p className="mt-1 text-xs text-ink-200">{OPPONENT_NOTE.body}</p>
          <div className="mt-2">
            <ExampleButton example={OPPONENT_NOTE.example} onUse={onUse} />
          </div>
        </section>
      </div>
    </Disclosure>
  );
}

function ExampleButton({ example, onUse }: { example: string; onUse: (example: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onUse(example)}
      className="flex min-h-11 w-full items-center rounded-xl border border-line-700 bg-pitch-850 px-3 py-2 text-left text-sm text-ink-200"
    >
      <span>“{example}”</span>
    </button>
  );
}
