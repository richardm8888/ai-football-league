import Link from 'next/link';
import { loadSquad, type SquadPlayer } from '@/services/club';
import { requireClubContext } from '@/services/page-context';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

const GROUPS: Array<{ label: string; positions: string[] }> = [
  { label: 'Goalkeepers', positions: ['GK'] },
  { label: 'Defenders', positions: ['DC', 'DL', 'DR'] },
  { label: 'Midfielders', positions: ['DM', 'MC', 'ML', 'MR'] },
  { label: 'Attackers', positions: ['AM', 'AML', 'AMR', 'ST'] },
];

export default async function SquadPage() {
  const context = await requireClubContext();
  const squad = await loadSquad(context.club.id);

  return (
    <>
      <PageHeader
        title="Squad"
        subtitle={`${squad.length} players · ${squad.filter((p) => p.available).length} available`}
      />
      <div className="space-y-5">
        {GROUPS.map((group) => {
          const players = squad
            .filter((p) => group.positions.includes(p.primaryPosition))
            .sort((a, b) => b.overall - a.overall);
          if (players.length === 0) return null;
          return (
            <section key={group.label}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-400">{group.label}</h2>
              <ul className="space-y-2">
                {players.map((player) => <PlayerRow key={player.id} player={player} />)}
              </ul>
            </section>
          );
        })}
        {squad.length === 0 && <Empty>This club has no players yet.</Empty>}
      </div>
    </>
  );
}

/**
 * A squad row, not a table cell. Dense football tables do not survive a 390px
 * screen, so every player is a tappable card that fits on one line plus detail.
 */
function PlayerRow({ player }: { player: SquadPlayer }) {
  return (
    <li>
      <Link
        href={`/squad/${player.id}`}
        className="flex items-center gap-3 rounded-xl border border-line-700/60 bg-pitch-900/80 p-3 active:bg-pitch-850"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pitch-800 text-sm font-bold tabular-nums text-ink-200">
          {player.shirtNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{player.name}</span>
            {player.injury !== 'NONE' && <Badge tone="bad">Injured</Badge>}
            {player.suspensionMatches > 0 && <Badge tone="warn">Susp.</Badge>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-400">
            <span>{player.primaryPosition}</span>
            {player.secondaryPositions.length > 0 && (
              <span className="text-ink-500">/ {player.secondaryPositions.join(', ')}</span>
            )}
            <span>· {player.age}y</span>
            <span>· fit {Math.round(player.fitness)}%</span>
            <span>· form {Math.round(player.form)}</span>
            {player.appearances > 0 && <span>· {player.goals}g {player.assists}a</span>}
          </span>
        </span>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600/15 text-base font-bold tabular-nums text-brand-400">
          {player.overall}
        </span>
      </Link>
    </li>
  );
}
