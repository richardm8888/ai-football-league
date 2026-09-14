'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom navigation.
 *
 * Five destinations, fixed to the bottom of the screen, inside the safe area.
 * This is the primary navigation on every screen size; on desktop it simply
 * centres with the content.
 */

const ITEMS = [
  { href: '/club', label: 'Club', icon: ShieldIcon },
  { href: '/squad', label: 'Squad', icon: PeopleIcon },
  { href: '/tactics', label: 'Tactics', icon: PitchIcon },
  { href: '/coach', label: 'Coach', icon: ChatIcon },
  { href: '/league', label: 'League', icon: TableIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line-700/70 bg-pitch-900/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[3.5rem] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium transition ${
                  active ? 'text-brand-400' : 'text-ink-400'
                }`}
              >
                <Icon active={active} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type IconProps = { active?: boolean };
const stroke = (active?: boolean) => (active ? 'currentColor' : 'currentColor');

function ShieldIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z" stroke={stroke(active)} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function PeopleIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke={stroke(active)} strokeWidth="1.7" />
      <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" stroke={stroke(active)} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 11a3 3 0 1 0-1.5-5.6M17 19c0-2-.6-3.6-1.7-4.7" stroke={stroke(active)} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function PitchIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke={stroke(active)} strokeWidth="1.7" />
      <path d="M12 4v16M3 9h3v6H3M21 9h-3v6h3" stroke={stroke(active)} strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.4" stroke={stroke(active)} strokeWidth="1.7" />
    </svg>
  );
}
function ChatIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8Z" stroke={stroke(active)} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function TableIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke={stroke(active)} strokeWidth="1.7" />
      <path d="M3 9.5h18M3 15h18M9 4v16" stroke={stroke(active)} strokeWidth="1.7" />
    </svg>
  );
}
