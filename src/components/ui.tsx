import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The shared visual vocabulary.
 *
 * Everything here is sized for a thumb first: minimum 44px touch targets, no
 * hover-only affordances, and no layout that depends on a wide viewport.
 */

export function Card({
  children, className = '', as: Tag = 'section',
}: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return (
    <Tag className={`rounded-2xl border border-line-700/60 bg-pitch-900/80 p-4 ${className}`}>
      {children}
    </Tag>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title, subtitle, action,
}: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-brand-600 text-pitch-950 font-semibold hover:bg-brand-500 active:bg-brand-600',
  secondary: 'bg-pitch-800 text-ink-50 border border-line-700 hover:bg-pitch-700',
  ghost: 'bg-transparent text-ink-200 border border-line-700 hover:bg-pitch-850',
  danger: 'bg-danger-500 text-pitch-950 font-semibold hover:bg-danger-400',
};

export function Button({
  children, tone = 'primary', className = '', type = 'button', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base transition disabled:cursor-not-allowed disabled:opacity-50 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href, children, tone = 'secondary', className = '',
}: { href: string; children: ReactNode; tone?: ButtonTone; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-base transition ${TONES[tone]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Badge({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  const tones = {
    neutral: 'bg-pitch-800 text-ink-200 border-line-700',
    good: 'bg-brand-600/15 text-brand-400 border-brand-600/40',
    warn: 'bg-warn-500/15 text-warn-400 border-warn-500/40',
    bad: 'bg-danger-500/15 text-danger-400 border-danger-500/40',
    info: 'bg-info-400/15 text-info-400 border-info-400/40',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A labelled 0-100 bar. Used everywhere familiarity or condition is shown. */
export function Meter({
  label, value, max = 100, hint, tone,
}: { label: string; value: number; max?: number; hint?: string; tone?: 'auto' | 'neutral' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour = tone === 'neutral'
    ? 'bg-info-400'
    : pct >= 70 ? 'bg-brand-500' : pct >= 45 ? 'bg-warn-500' : 'bg-danger-500';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink-200">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-pitch-800" role="img" aria-label={`${label}: ${Math.round(value)} out of ${max}`}>
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line-700 px-4 py-6 text-center text-sm text-ink-400">
      {children}
    </p>
  );
}

export function Alert({
  tone = 'info', title, children,
}: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: ReactNode }) {
  const tones = {
    info: 'border-info-400/40 bg-info-400/10 text-ink-50',
    warn: 'border-warn-500/40 bg-warn-500/10 text-ink-50',
    bad: 'border-danger-500/45 bg-danger-500/10 text-ink-50',
    good: 'border-brand-600/40 bg-brand-600/10 text-ink-50',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role={tone === 'bad' ? 'alert' : undefined}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="space-y-1 text-ink-200">{children}</div>
    </div>
  );
}

export function Field({
  label, hint, children, htmlFor,
}: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1.5 block text-sm font-medium text-ink-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full min-h-11 rounded-xl border border-line-700 bg-pitch-850 px-3.5 py-2.5 text-ink-50 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-600/30';

export function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

/** Horizontally scrollable chip row: the mobile answer to a wide tab bar. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-x -mx-4 px-4">
      <div className="flex w-max gap-2 pb-1">{children}</div>
    </div>
  );
}

export function formLabel(value: string): ReactNode {
  return (
    <span className="inline-flex gap-1">
      {value.split('').map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${
            result === 'W' ? 'bg-brand-600 text-pitch-950'
              : result === 'D' ? 'bg-ink-500 text-pitch-950' : 'bg-danger-500 text-pitch-950'
          }`}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^f (\d)/, '$1')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The coach as the front door.
 *
 * Every screen that used to open on a form now opens on this: say what you
 * want, and the staff set it up. The form is still there underneath for the
 * times a manager wants one specific thing changed and would rather do it than
 * describe it.
 */
export function CoachFirst({ what, examples }: { what: string; examples: string[] }) {
  return (
    <Card className="border-brand-600/40 bg-brand-600/5">
      <CardTitle>Tell your staff</CardTitle>
      <p className="text-sm text-ink-200">{what}</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-400">
        {examples.map((example) => (
          <li key={example} className="italic">“{example}”</li>
        ))}
      </ul>
      <LinkButton href="/coach" tone="primary" className="mt-3 w-full sm:w-auto">
        Talk to your coaching staff
      </LinkButton>
    </Card>
  );
}

/**
 * Something folded away until it is wanted.
 *
 * A native <details> rather than state: it works before hydration, it is
 * keyboard and screen-reader accessible for free, and the browser remembers
 * nothing between visits, which is right — the point is that opening it is a
 * deliberate act each time.
 */
export function Disclosure({
  label, children, className = '', tone = 'muted',
}: { label: ReactNode; children: ReactNode; className?: string; tone?: 'muted' | 'brand' }) {
  return (
    <details
      className={`group rounded-2xl border ${
        tone === 'brand' ? 'border-brand-600/40 bg-brand-600/5' : 'border-line-700/60 bg-pitch-900/40'
      } ${className}`}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm text-ink-300">
        <span>{label}</span>
        <span aria-hidden="true" className="text-ink-500 transition group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-line-700/60 p-4">{children}</div>
    </details>
  );
}

/** The manual editor, folded away behind its own deliberate tap. */
export function ManualOverride({
  label, children,
}: { label: string; children: ReactNode }) {
  return <Disclosure label={label}>{children}</Disclosure>;
}
