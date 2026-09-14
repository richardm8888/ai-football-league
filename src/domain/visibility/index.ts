import type { ClubTrend } from '../reports/roundup';
import type { MatchdayPhase } from '../types';

/**
 * Information visibility.
 *
 * Three levels, enforced here rather than in the UI: public facts every manager
 * sees, private club information only the owning manager sees, and scouted
 * estimates, which are explicitly marked as estimates so nobody mistakes them
 * for confirmed data.
 */

export type InformationLevel = 'PUBLIC' | 'PRIVATE' | 'SCOUTED';

export interface Viewer {
  userId: string;
  /** Clubs this user manages. */
  clubIds: string[];
  /** Leagues this user belongs to. */
  leagueIds: string[];
  isLeagueAdmin: boolean;
  isSuperAdmin: boolean;
}

export function canViewLeague(viewer: Viewer, leagueId: string): boolean {
  return viewer.isSuperAdmin || viewer.leagueIds.includes(leagueId);
}

export function ownsClub(viewer: Viewer, clubId: string): boolean {
  return viewer.clubIds.includes(clubId);
}

/** Private club information: training, unsubmitted plans, AI conversations. */
export function canViewClubPrivate(viewer: Viewer, clubId: string): boolean {
  return viewer.isSuperAdmin || ownsClub(viewer, clubId);
}

/** Only the owning manager may submit or change a club's decisions. */
export function canManageClub(viewer: Viewer, clubId: string): boolean {
  return ownsClub(viewer, clubId);
}

/**
 * An opponent's exact plan stays secret until the match has been played. This is
 * the rule that stops the league becoming an information race.
 */
export function canViewMatchPlan(
  viewer: Viewer, clubId: string, phase: MatchdayPhase,
): boolean {
  if (canViewClubPrivate(viewer, clubId)) return true;
  return phase === 'POST_MATCH' || phase === 'COMPLETE';
}

/** Reports are published to the whole league once the matchday is simulated. */
export function canViewReport(viewer: Viewer, leagueId: string, phase: MatchdayPhase): boolean {
  if (!canViewLeague(viewer, leagueId)) return false;
  return phase === 'POST_MATCH' || phase === 'COMPLETE';
}

// ---------------------------------------------------------------------------
// Scouting
// ---------------------------------------------------------------------------

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScoutedObservation {
  label: string;
  /** A qualitative band, never a precise private number. */
  estimate: string;
  confidence: Confidence;
  /** The public statistic the estimate was drawn from. */
  basis: string;
}

export interface ScoutingView {
  clubId: string;
  clubName: string;
  matchesObserved: number;
  confidence: Confidence;
  observations: ScoutedObservation[];
  caveat: string;
}

function confidenceFor(matches: number): Confidence {
  if (matches >= 6) return 'HIGH';
  if (matches >= 3) return 'MEDIUM';
  return 'LOW';
}

function band(value: number, thresholds: [number, number], labels: [string, string, string]): string {
  if (value < thresholds[0]) return labels[0];
  if (value < thresholds[1]) return labels[1];
  return labels[2];
}

/**
 * Build an opponent profile from public match data only. Everything returned is
 * an inference from published statistics and is labelled as such.
 */
export function scoutOpponent(trend: ClubTrend): ScoutingView {
  const confidence = confidenceFor(trend.matchesPlayed);
  const observations: ScoutedObservation[] = [];

  observations.push({
    label: 'Possession',
    estimate: band(trend.averagePossession, [46, 54],
      ['happy without the ball', 'shares possession evenly', 'wants to dominate the ball']),
    confidence,
    basis: `${trend.averagePossession}% average possession over ${trend.matchesPlayed} match${trend.matchesPlayed === 1 ? '' : 'es'}`,
  });

  observations.push({
    label: 'Pressing',
    estimate: band(trend.averagePressingRate, [0.35, 0.5],
      ['sits in a block', 'presses selectively', 'presses aggressively']),
    confidence,
    basis: `${trend.averagePressingRate} defensive actions per opposition sequence`,
  });

  observations.push({
    label: 'Directness',
    estimate: band(trend.averageDirectness, [0.25, 0.45],
      ['builds patiently', 'mixes build-up', 'goes long early']),
    confidence,
    basis: `${(trend.averageDirectness * 100).toFixed(0)}% of sequences started long`,
  });

  observations.push({
    label: 'Shape',
    estimate: trend.formationsUsed.length > 1
      ? `rotates between ${trend.formationsUsed.join(' and ')}`
      : `consistently ${trend.formationsUsed[0] ?? 'unknown'}`,
    confidence,
    basis: `${trend.formationsUsed.length} formation${trend.formationsUsed.length === 1 ? '' : 's'} used, ${trend.formationChanges} in-match adjustment${trend.formationChanges === 1 ? '' : 's'}`,
  });

  if (trend.goalsConcededFromCounterAttacks > 0) {
    observations.push({
      label: 'Transition defence',
      estimate: trend.goalsConcededFromCounterAttacks >= 2
        ? 'repeatedly opened up on the counter'
        : 'has been caught on the counter',
      confidence,
      basis: `${trend.goalsConcededFromCounterAttacks} goal${trend.goalsConcededFromCounterAttacks === 1 ? '' : 's'} conceded from transitions`,
    });
  }
  if (trend.goalsFromSetPieces > 0) {
    observations.push({
      label: 'Set pieces',
      estimate: 'a genuine set-piece threat',
      confidence,
      basis: `${trend.goalsFromSetPieces} set-piece goal${trend.goalsFromSetPieces === 1 ? '' : 's'} scored`,
    });
  }
  observations.push({
    label: 'Discipline',
    estimate: band(trend.cardsPerMatch, [1.5, 2.5], ['disciplined', 'normal', 'card-prone']),
    confidence,
    basis: `${trend.cardsPerMatch} cards per match`,
  });

  return {
    clubId: trend.clubId,
    clubName: trend.clubName,
    matchesObserved: trend.matchesPlayed,
    confidence,
    observations,
    caveat: trend.matchesPlayed < 3
      ? 'Based on very few matches. Treat every read as provisional.'
      : 'Estimates inferred from published match data, not from inside information.',
  };
}
