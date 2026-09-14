'use client';

import { getFormation } from '@/domain/tactics/formations';
import { ROLE_DEFINITIONS } from '@/domain/tactics/roles';
import { positionSuitability, suitabilityBand } from '@/domain/tactics/suitability';
import type { Formation } from '@/domain/types';
import type { EditorPlayer } from './tactics-editor-types';

/**
 * The pitch.
 *
 * Tapping a shirt opens the selection sheet. There is deliberately no
 * drag-and-drop: it is unreliable on touch and impossible with assistive
 * technology, and every slot is reachable with one thumb as a plain button.
 */
export function Pitch({
  formation, assignments, players, onSelectSlot, selectedSlot,
}: {
  formation: Formation;
  assignments: Array<{ slot: string; playerId: string; role: string }>;
  players: Map<string, EditorPlayer>;
  onSelectSlot: (slot: string) => void;
  selectedSlot: string | null;
}) {
  const definition = getFormation(formation);
  const bySlot = new Map(assignments.map((a) => [a.slot, a]));

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-line-700/60"
      style={{ aspectRatio: '3 / 4', maxWidth: '100%', background: 'linear-gradient(0deg, #0c1f14 0%, #113026 100%)' }}
    >
      {/* Pitch markings */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="absolute inset-x-[6%] inset-y-[3%] rounded-lg border border-white/12" />
        <div className="absolute left-1/2 top-1/2 h-[16%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/12" />
        <div className="absolute inset-x-[6%] top-1/2 h-px bg-white/12" />
        <div className="absolute inset-x-[26%] top-[3%] h-[13%] border border-t-0 border-white/12" />
        <div className="absolute inset-x-[26%] bottom-[3%] h-[13%] border border-b-0 border-white/12" />
      </div>

      {definition.slots.map((slot) => {
        const assignment = bySlot.get(slot.key);
        const player = assignment ? players.get(assignment.playerId) : undefined;
        const suitability = player ? positionSuitability(player, slot.position) : 0;
        const band = suitabilityBand(suitability);
        const selected = selectedSlot === slot.key;

        const tone = !player ? 'border-dashed border-white/40 bg-pitch-950/70 text-ink-400'
          : band === 'MAKESHIFT' ? 'border-danger-500 bg-danger-500/20 text-ink-50'
            : band === 'AWKWARD' ? 'border-warn-500 bg-warn-500/20 text-ink-50'
              : 'border-white/25 bg-pitch-950/85 text-ink-50';

        return (
          <button
            key={slot.key}
            type="button"
            onClick={() => onSelectSlot(slot.key)}
            aria-label={player
              ? `${slot.label}: ${player.name}, ${ROLE_DEFINITIONS[assignment!.role as keyof typeof ROLE_DEFINITIONS]?.label ?? assignment!.role}. Change.`
              : `${slot.label}: empty. Choose a player.`}
            className={`absolute flex min-h-[3rem] w-[21%] -translate-x-1/2 translate-y-[-50%] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-center transition ${tone} ${
              selected ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-pitch-900' : ''
            }`}
            style={{ left: `${slot.x}%`, top: `${100 - slot.y}%` }}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{slot.label}</span>
            {player ? (
              <>
                <span className="w-full truncate text-[11px] font-semibold leading-tight">
                  {player.lastName}
                </span>
                <span className="w-full truncate text-[9px] leading-tight opacity-70">
                  {shortRole(assignment!.role)}
                </span>
              </>
            ) : (
              <span className="text-[11px]">Empty</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function shortRole(role: string): string {
  const label = ROLE_DEFINITIONS[role as keyof typeof ROLE_DEFINITIONS]?.label ?? role;
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}
