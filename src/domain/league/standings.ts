/** League table construction. Three points for a win, goal difference, then goals scored. */

export interface PlayedFixture {
  matchdayNumber: number;
  homeClubId: string;
  awayClubId: string;
  homeGoals: number;
  awayGoals: number;
}

export interface TableRow {
  clubId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Newest result last, at most five characters. */
  formGuide: string;
}

export function buildTable(clubIds: string[], fixtures: PlayedFixture[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const clubId of clubIds) {
    rows.set(clubId, {
      clubId, position: 0, played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, formGuide: '',
    });
  }

  const ordered = [...fixtures].sort((a, b) => a.matchdayNumber - b.matchdayNumber);
  for (const fixture of ordered) {
    const home = rows.get(fixture.homeClubId);
    const away = rows.get(fixture.awayClubId);
    if (!home || !away) continue;
    home.played += 1; away.played += 1;
    home.goalsFor += fixture.homeGoals; home.goalsAgainst += fixture.awayGoals;
    away.goalsFor += fixture.awayGoals; away.goalsAgainst += fixture.homeGoals;
    if (fixture.homeGoals > fixture.awayGoals) {
      home.won += 1; home.points += 3; home.formGuide += 'W';
      away.lost += 1; away.formGuide += 'L';
    } else if (fixture.homeGoals < fixture.awayGoals) {
      away.won += 1; away.points += 3; away.formGuide += 'W';
      home.lost += 1; home.formGuide += 'L';
    } else {
      home.drawn += 1; home.points += 1; home.formGuide += 'D';
      away.drawn += 1; away.points += 1; away.formGuide += 'D';
    }
  }

  const table = [...rows.values()].map((row) => ({
    ...row,
    goalDifference: row.goalsFor - row.goalsAgainst,
    formGuide: row.formGuide.slice(-5),
  }));

  table.sort((a, b) =>
    b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.clubId.localeCompare(b.clubId));

  table.forEach((row, index) => { row.position = index + 1; });
  return table;
}

export function ordinal(position: number): string {
  const rules = new Intl.PluralRules('en-GB', { type: 'ordinal' });
  const suffixes: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
  return `${position}${suffixes[rules.select(position)] ?? 'th'}`;
}
