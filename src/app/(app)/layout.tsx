import Link from 'next/link';
import { BottomNav } from '@/components/nav';
import { Tour } from '@/components/tour';
import { loadPageContext } from '@/services/page-context';

/**
 * The shell every management screen sits in: a compact top bar with the club
 * identity, the content column, and fixed bottom navigation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await loadPageContext();

  return (
    <div className="min-h-dvh">
      <header className="safe-top sticky top-0 z-30 border-b border-line-700/60 bg-pitch-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/club" className="flex min-h-11 min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-7 w-7 shrink-0 rounded-lg border border-white/15"
              style={{ background: context.club?.primaryColor ?? '#1f6feb' }}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">
                {context.club?.name ?? 'No club yet'}
              </span>
              <span className="block truncate text-[11px] leading-tight text-ink-500">
                {context.league.name}
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Tour seen={context.user.tourSeenAt !== null} />
            {context.league.isAdmin && (
              <Link href="/admin" className="flex min-h-11 items-center rounded-lg border border-line-700 px-3 text-xs text-ink-200">
                Admin
              </Link>
            )}
            <form action="/api/signout" method="post">
              <button type="submit" className="flex min-h-11 items-center rounded-lg border border-line-700 px-3 text-xs text-ink-200">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}
