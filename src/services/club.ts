import { prisma } from '@/lib/db';
import {
  emptyClubFamiliarity, type ClubFamiliarity, type PlayerFamiliarityMap,
} from '@/domain/familiarity';
import type { SquadPlayerView } from '@/domain/validation';
import type { SelectablePlayer } from '@/domain/tactics/selection';
import { overallRating, positionSuitability } from '@/domain/tactics/suitability';
import type {
  BuildUp, DefensiveApproach, Formation, PlayerAttributes, PlayerRole, PlayingStyle,
  Position, PressingIntensity,
} from '@/domain/types';
import type { BuildablePlayer } from '@/engine/build';

/**
 * Loading a club's squad and familiarity out of the database and into the
 * shapes the pure domain and engine layers expect.
 */

export interface SquadPlayer {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  age: number;
  shirtNumber: number;
  primaryPosition: Position;
  secondaryPositions: Position[];
  preferredFoot: string;
  potential: number;
  personality: string;
  contractUntil: number;
  wageThousands: number;
  attributes: PlayerAttributes;
  overall: number;
  fitness: number;
  fatigue: number;
  morale: number;
  form: number;
  confidence: number;
  matchSharpness: number;
  injury: string;
  injuryDescription: string | null;
  injuryWeeksLeft: number;
  suspensionMatches: number;
  yellowCardsSeason: number;
  redCardsSeason: number;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  averageRating: number;
  available: boolean;
}

const ATTRIBUTE_FIELDS = [
  'passing', 'firstTouch', 'dribbling', 'finishing', 'crossing', 'tackling', 'marking',
  'heading', 'longShots', 'setPieces', 'decisions', 'positioning', 'composure',
  'concentration', 'anticipation', 'workRate', 'teamwork', 'vision', 'determination',
  'pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance',
  'handling', 'reflexes', 'oneOnOnes', 'distribution',
] as const;

type PlayerRow = Awaited<ReturnType<typeof loadSquadRows>>[number];

function loadSquadRows(clubId: string) {
  return prisma.player.findMany({
    where: { clubId },
    include: { attributes: true, state: true },
    orderBy: [{ primaryPosition: 'asc' }, { shirtNumber: 'asc' }],
  });
}

function toAttributes(row: PlayerRow): PlayerAttributes {
  const source = row.attributes;
  const attributes = {} as PlayerAttributes;
  for (const key of ATTRIBUTE_FIELDS) {
    attributes[key] = source ? (source[key] as number) : 40;
  }
  return attributes;
}

export async function loadSquad(clubId: string): Promise<SquadPlayer[]> {
  const rows = await loadSquadRows(clubId);
  return rows.map((row) => {
    const attributes = toAttributes(row);
    const state = row.state;
    const appearances = state?.appearances ?? 0;
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      name: `${row.firstName} ${row.lastName}`,
      age: row.age,
      shirtNumber: row.shirtNumber,
      primaryPosition: row.primaryPosition as Position,
      secondaryPositions: row.secondaryPositions as Position[],
      preferredFoot: row.preferredFoot,
      potential: row.potential,
      personality: row.personality,
      contractUntil: row.contractUntil,
      wageThousands: row.wageThousands,
      attributes,
      overall: overallRating(attributes, row.primaryPosition as Position),
      fitness: state?.fitness ?? 100,
      fatigue: state?.fatigue ?? 0,
      morale: state?.morale ?? 60,
      form: state?.form ?? 50,
      confidence: state?.confidence ?? 50,
      matchSharpness: state?.matchSharpness ?? 60,
      injury: state?.injury ?? 'NONE',
      injuryDescription: state?.injuryDescription ?? null,
      injuryWeeksLeft: state?.injuryWeeksLeft ?? 0,
      suspensionMatches: state?.suspensionMatches ?? 0,
      yellowCardsSeason: state?.yellowCardsSeason ?? 0,
      redCardsSeason: state?.redCardsSeason ?? 0,
      appearances,
      goals: state?.goals ?? 0,
      assists: state?.assists ?? 0,
      minutes: state?.minutes ?? 0,
      averageRating: appearances > 0 ? Number(((state?.ratingSum ?? 0) / appearances).toFixed(2)) : 0,
      available: (state?.injury ?? 'NONE') === 'NONE' && (state?.suspensionMatches ?? 0) === 0,
    };
  });
}

export function toValidationView(players: SquadPlayer[]): SquadPlayerView[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    fitness: Math.round(p.fitness),
    injured: p.injury !== 'NONE',
    injuryDescription: p.injuryDescription,
    suspended: p.suspensionMatches > 0,
  }));
}

export function toSelectableView(players: SquadPlayer[]): SelectablePlayer[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    attributes: p.attributes,
    fitness: Math.round(p.fitness),
    form: Math.round(p.form),
    injured: p.injury !== 'NONE',
    suspended: p.suspensionMatches > 0,
  }));
}

export function toEngineView(players: SquadPlayer[]): BuildablePlayer[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    shirtNumber: p.shirtNumber,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    attributes: p.attributes,
    fitness: p.fitness,
    form: p.form,
    morale: p.morale,
    confidence: p.confidence,
    matchSharpness: p.matchSharpness,
  }));
}

export function positionFit(player: SquadPlayer, position: Position): number {
  return positionSuitability(player, position);
}

// ---------------------------------------------------------------------------
// Familiarity
// ---------------------------------------------------------------------------

export async function loadClubFamiliarity(clubId: string): Promise<ClubFamiliarity> {
  const rows = await prisma.tacticalFamiliarity.findMany({ where: { clubId } });
  const familiarity = emptyClubFamiliarity();
  for (const row of rows) {
    switch (row.dimension) {
      case 'FORMATION': familiarity.FORMATION[row.key as Formation] = row.value; break;
      case 'PLAYING_STYLE': familiarity.PLAYING_STYLE[row.key as PlayingStyle] = row.value; break;
      case 'PRESSING': familiarity.PRESSING[row.key as PressingIntensity] = row.value; break;
      case 'DEFENSIVE_ORGANISATION': familiarity.DEFENSIVE_ORGANISATION[row.key as DefensiveApproach] = row.value; break;
      case 'BUILD_UP': familiarity.BUILD_UP[row.key as BuildUp] = row.value; break;
      case 'TRANSITION': familiarity.TRANSITION = row.value; break;
      case 'SET_PIECES': familiarity.SET_PIECES = row.value; break;
      case 'OVERALL_STABILITY': familiarity.OVERALL_STABILITY = row.value; break;
    }
  }
  return familiarity;
}

export async function saveClubFamiliarity(clubId: string, familiarity: ClubFamiliarity): Promise<void> {
  const rows: Array<{ dimension: string; key: string; value: number }> = [];
  const push = (dimension: string, map: Record<string, number | undefined>) => {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'number') rows.push({ dimension, key, value });
    }
  };
  push('FORMATION', familiarity.FORMATION);
  push('PLAYING_STYLE', familiarity.PLAYING_STYLE);
  push('PRESSING', familiarity.PRESSING);
  push('DEFENSIVE_ORGANISATION', familiarity.DEFENSIVE_ORGANISATION);
  push('BUILD_UP', familiarity.BUILD_UP);
  rows.push({ dimension: 'TRANSITION', key: '_', value: familiarity.TRANSITION });
  rows.push({ dimension: 'SET_PIECES', key: '_', value: familiarity.SET_PIECES });
  rows.push({ dimension: 'OVERALL_STABILITY', key: '_', value: familiarity.OVERALL_STABILITY });

  await prisma.$transaction(rows.map((row) =>
    prisma.tacticalFamiliarity.upsert({
      where: {
        clubId_dimension_key: {
          clubId,
          dimension: row.dimension as never,
          key: row.key,
        },
      },
      create: { clubId, dimension: row.dimension as never, key: row.key, value: row.value },
      update: { value: row.value },
    })));
}

export async function loadPlayerFamiliarity(clubId: string): Promise<PlayerFamiliarityMap> {
  const rows = await prisma.playerFamiliarity.findMany({ where: { player: { clubId } } });
  const map: PlayerFamiliarityMap = {};
  for (const row of rows) {
    if (!map[row.playerId]) map[row.playerId] = { roles: {}, positions: {} };
    if (row.kind === 'ROLE') {
      map[row.playerId].roles[row.key as PlayerRole] = row.value;
    } else {
      map[row.playerId].positions[row.key as Position] = row.value;
    }
  }
  return map;
}

export async function savePlayerFamiliarity(map: PlayerFamiliarityMap): Promise<void> {
  const operations = [];
  for (const [playerId, entry] of Object.entries(map)) {
    for (const [key, value] of Object.entries(entry.roles)) {
      if (typeof value !== 'number') continue;
      operations.push(prisma.playerFamiliarity.upsert({
        where: { playerId_kind_key: { playerId, kind: 'ROLE', key } },
        create: { playerId, kind: 'ROLE', key, value },
        update: { value },
      }));
    }
    for (const [key, value] of Object.entries(entry.positions)) {
      if (typeof value !== 'number') continue;
      operations.push(prisma.playerFamiliarity.upsert({
        where: { playerId_kind_key: { playerId, kind: 'POSITION', key } },
        create: { playerId, kind: 'POSITION', key, value },
        update: { value },
      }));
    }
  }
  // Chunked so a large squad does not build one enormous transaction.
  for (let i = 0; i < operations.length; i += 100) {
    await prisma.$transaction(operations.slice(i, i + 100));
  }
}
