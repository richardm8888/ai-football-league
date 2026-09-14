import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/services/auth';
import { JoinForms } from '@/components/join-forms';

export default async function JoinPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const membership = await prisma.leagueMembership.findFirst({ where: { userId: user.id } });
  if (membership) redirect('/club');

  return (
    <div className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-400">AI Football League</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Find your league</h1>
        <p className="mt-2 text-sm text-ink-400">
          Join the private league a friend set up, or start one of your own.
        </p>
      </div>
      <JoinForms />
      <p className="mt-6 text-center text-sm text-ink-400">
        <Link href="/login" className="text-brand-400 underline underline-offset-4">Sign in as someone else</Link>
      </p>
    </div>
  );
}
