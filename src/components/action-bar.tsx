'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Feedback where the thumb already is.
 *
 * Saving, approving and locking used to confirm themselves in an alert at the
 * top of the page, several screens above the button that caused them. On a
 * phone that alert is off-screen: the manager presses Save, nothing visibly
 * happens, and they conclude the app ignored them. The same misreading that
 * made the coaching staff look inert.
 *
 * So every consequence of a submission renders in this bar: the button says
 * what it did, the line beneath it says what happened and when, and a refusal
 * appears against the control that was refused rather than somewhere the
 * manager would have to go looking.
 */

export function ActionBar({ children }: { children: ReactNode }) {
  // Pinned above the bottom navigation. Everything in here stacks upwards from
  // the buttons: a sticky box can be clamped to the top of its containing
  // block — which happens when one of the folded-away editors is opened while
  // the page is at the top — and anything below the buttons would then be the
  // part that ends up under the navigation.
  return (
    <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-line-700/60 bg-pitch-950/95 px-4 py-3 backdrop-blur">
      {children}
    </div>
  );
}

const NOTE_TONES = {
  good: 'text-brand-400',
  bad: 'text-danger-400',
  warn: 'text-warn-400',
  muted: 'text-ink-500',
};

/**
 * One line of consequence, directly beneath the control.
 *
 * `role="status"` so a manager using a screen reader hears the confirmation
 * they cannot see; a refusal is an alert, because it interrupts what they were
 * doing.
 */
export function ActionNote({
  tone = 'muted', children, className = '',
}: { tone?: keyof typeof NOTE_TONES; children: ReactNode; className?: string }) {
  return (
    <p
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`text-xs leading-snug break-words ${NOTE_TONES[tone]} ${className}`}
    >
      {children}
    </p>
  );
}

/**
 * A submit button that reports its own state.
 *
 * Three labels rather than two: what it does, what it is doing, and what it
 * did. The settled label is driven by what the server said it saved, not by a
 * timer, so it survives a re-render and cannot outlive the fact it describes.
 *
 * `name` and `value` also identify which button was pressed when a form has
 * more than one, so approving does not make Save draft say it is working.
 */
export function ActionSubmit({
  children, pendingLabel = 'Working…', settledLabel, settled = false,
  disabled = false, name, value, className = '',
}: {
  children: ReactNode;
  pendingLabel?: string;
  settledLabel?: ReactNode;
  settled?: boolean;
  disabled?: boolean;
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!name || data?.get(name) === value);

  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled || pending}
      aria-live="polite"
      className={className}
    >
      {mine ? pendingLabel : settled && settledLabel ? settledLabel : children}
    </button>
  );
}

/** The time a save landed, on the same clock the deadline is shown on. */
export function atTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
