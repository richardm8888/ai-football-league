'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { markTourSeenAction } from '@/app/actions/tour';

/**
 * The first week, explained before it costs you one.
 *
 * A manager arriving for the first time lands on a squad and a text box with no
 * sense that the week has a shape, that plans commit at a deadline, or that
 * sticking with a system is worth anything. None of that is discoverable by
 * poking at it: the deadline only announces itself by having passed.
 *
 * Six cards, shown once, dismissible at any point, and reachable again from the
 * help button in the top bar. Dismissing counts as having seen it — the flag is
 * per user and never unset, so this can never become something a manager has to
 * close every week.
 *
 * The overlay renders through a portal because the top bar it is launched from
 * has a backdrop filter, which would otherwise become the containing block for
 * anything fixed inside it and trap the dialog inside the header.
 */

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: 'A week has a shape',
    body: 'Every matchday runs the same loop: tell your coaching staff how you want to play, '
      + 'check what they changed, lock your plan in before the deadline, then read the result. '
      + 'The Club screen always says where this week has got to.',
  },
  {
    title: 'Your instruction is the decision',
    body: 'Say what you want in your own words on the Coach screen and your staff set it up '
      + 'there and then. The reply lists exactly what moved — "Pressing medium to high", '
      + '"In: Costa, Out: Berg" — and one tap puts it all back if they read you wrong.',
  },
  {
    title: 'They understand more than you would guess',
    body: 'Shape and style, pressing and defending, how to respond to the score, who plays and '
      + 'who is rested, and what the week on the training ground works on. "What you can ask '
      + 'for" on the Coach screen lists the lot, with an example of each you can tap.',
  },
  {
    title: 'Talking about the opposition is not an instruction',
    body: 'Your staff treat anything you say about them as context. "They press aggressively" '
      + 'tells the staff what to expect from the opposition; it does not ask your own side to '
      + 'press. Say what you want your side to do and you will get it.',
  },
  {
    title: 'Nothing counts until you lock in',
    body: 'A plan sits as a draft until you lock it, and you can change it as often as you like '
      + 'before then. When the deadline passes, every plan still outstanding is committed exactly '
      + 'as it stands — so an unfinished plan still plays.',
  },
  {
    title: 'Sticking with a system pays, and you can always do it yourself',
    body: 'Your side rehearses what it plays: familiarity is tracked for each setting, and a '
      + 'shape drilled for weeks is executed far better than one picked on matchday. When you '
      + 'would rather set something by hand, the full editors are under "Set it manually '
      + 'instead" on Tactics and Training.',
  },
];

/**
 * A backstop for the seconds between dismissing the walkthrough and the write
 * that records it landing. The per-user flag on the server is the real record;
 * this only stops a manager who dismisses it and immediately reloads from being
 * shown it a second time. It is allowed to be unavailable.
 */
const DISMISSED_KEY = 'aifl.tour.dismissed';

function dismissedHere(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function Tour({ seen }: { seen: boolean }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Runs itself for a manager who has never seen it. After hydration rather
  // than during render, so the screen behind it paints first and a returning
  // manager never sees a flash of something they dismissed months ago.
  useEffect(() => {
    setMounted(true);
    if (!seen && !dismissedHere()) setOpen(true);
  }, [seen]);

  const close = useCallback(() => {
    setOpen(false);
    setStep(0);
    // Any dismissal counts, including the escape key: being shown it twice is
    // the failure this is guarding against.
    if (seen) return;
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private browsing, or storage refused. The server flag is the record.
    }
    void markTourSeenAction();
  }, [seen]);

  useEffect(() => {
    if (!open) return undefined;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // The page behind a modal should not scroll under the thumb.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <>
      <button
        type="button"
        onClick={() => { setStep(0); setOpen(true); }}
        aria-haspopup="dialog"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-700 text-sm text-ink-200"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">How a week works</span>
      </button>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-pitch-950/85 p-4 backdrop-blur-sm sm:items-center"
          onClick={close}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            className="safe-bottom max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line-700 bg-pitch-900 p-4 outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                How a week works · {step + 1} of {STEPS.length}
              </p>
              <button
                type="button"
                onClick={close}
                className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-400"
              >
                <span aria-hidden="true">✕</span>
                <span className="sr-only">Close</span>
              </button>
            </div>

            <h2 id="tour-title" className="mt-1 text-lg font-bold tracking-tight">{current.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-200">{current.body}</p>

            <div aria-hidden="true" className="mt-4 flex gap-1.5">
              {STEPS.map((item, index) => (
                <span
                  key={item.title}
                  className={`h-1.5 flex-1 rounded-full ${index <= step ? 'bg-brand-500' : 'bg-pitch-800'}`}
                />
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setStep((value) => Math.max(0, value - 1))}
                disabled={step === 0}
                className="min-h-11 rounded-xl border border-line-700 px-4 text-sm text-ink-200 disabled:opacity-40"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => (last ? close() : setStep((value) => value + 1))}
                className="min-h-11 flex-1 rounded-xl bg-brand-600 px-4 font-semibold text-pitch-950"
              >
                {last ? 'Start managing' : 'Next'}
              </button>
            </div>
          </div>
        </div>,
        document.body)}
    </>
  );
}
