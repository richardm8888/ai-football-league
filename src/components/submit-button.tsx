'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui';

/** A submit button that shows the request is in flight. Server actions only. */
export function SubmitButton({
  children, pendingLabel = 'Working…', tone = 'primary', className = '', name, value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" tone={tone} disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
