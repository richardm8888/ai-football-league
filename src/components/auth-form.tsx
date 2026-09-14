'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/app/actions/auth';
import { SubmitButton } from './submit-button';
import { Alert, Field, inputClass } from './ui';

export function AuthForm({
  action, submitLabel, fields, footer,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  fields: Array<{ name: string; label: string; type?: string; hint?: string; autoComplete?: string; required?: boolean }>;
  footer?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {fields.map((field) => (
        <Field key={field.name} label={field.label} hint={field.hint} htmlFor={field.name}>
          <input
            id={field.name}
            name={field.name}
            type={field.type ?? 'text'}
            autoComplete={field.autoComplete}
            required={field.required ?? true}
            className={inputClass}
          />
        </Field>
      ))}
      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
      {footer}
    </form>
  );
}

export function AuthShell({ title, subtitle, children, alternate }: {
  title: string; subtitle: string; children: React.ReactNode;
  alternate: { href: string; label: string };
}) {
  return (
    <div className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-400">AI Football League</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-400">{subtitle}</p>
      </div>
      {children}
      <p className="mt-6 text-center text-sm text-ink-400">
        <Link href={alternate.href} className="text-brand-400 underline underline-offset-4">{alternate.label}</Link>
      </p>
    </div>
  );
}
