import { CARDS_PER_TURN } from './types';

/**
 * Scoring, in one place, as pure functions.
 *
 * The database performs the authoritative calculation (see `_score_turn` in
 * supabase/migrations/0060_rpc_turn.sql). These functions are the same rules expressed
 * for tests and for explaining numbers in the UI. The client never sends a score to the
 * server; it only ever renders one it was given.
 *
 * Competitive rule
 *   raw_turn_score = number of cards whose guessed position equals the Ranker's position
 *   awarded_turn_score = 0 if a skipped-Ranker penalty applies, otherwise raw_turn_score
 *
 * Cooperative rule (always shown alongside, never a mode the Host has to choose)
 *   possible_points   = eligible_guessers * 5     (the Ranker is not counted)
 *   group_turn_points = sum of awarded exact matches
 *   game_turn_points  = possible_points - group_turn_points
 */

export type GuesserSubmission = {
  playerId: string;
  /** null means they never submitted before the deadline. */
  order: string[] | null;
  /** Outstanding skipped-Ranker penalties this player is carrying into the turn. */
  pendingPenalties: number;
};

export type GuesserTurnScore = {
  playerId: string;
  submitted: boolean;
  /** Exact positional matches, before any penalty. Always reported so the reveal can
   *  show "you actually got 4, but your score is 0 because ...". */
  rawScore: number;
  awardedScore: number;
  penaltyApplied: boolean;
  groupPointsDelta: number;
  gamePointsDelta: number;
};

export type TurnScore = {
  perPlayer: GuesserTurnScore[];
  eligibleGuessers: number;
  possiblePoints: number;
  groupPoints: number;
  gamePoints: number;
  /** A skipped Ranker turn scores nothing at all, for anyone. */
  skipped: boolean;
};

/** How many cards sit in the same place in both orders. */
export function countExactMatches(
  rankerOrder: readonly string[],
  guessOrder: readonly string[] | null,
): number {
  if (!guessOrder) return 0;
  let matches = 0;
  for (let i = 0; i < rankerOrder.length; i += 1) {
    if (guessOrder[i] !== undefined && guessOrder[i] === rankerOrder[i]) matches += 1;
  }
  return matches;
}

export function scoreTurn(input: {
  rankerOrder: readonly string[];
  guessers: readonly GuesserSubmission[];
  skipped?: boolean;
}): TurnScore {
  if (input.skipped) {
    return {
      perPlayer: [],
      eligibleGuessers: 0,
      possiblePoints: 0,
      groupPoints: 0,
      gamePoints: 0,
      skipped: true,
    };
  }

  const perPlayer = input.guessers.map((guesser): GuesserTurnScore => {
    const submitted = guesser.order !== null;
    const rawScore = countExactMatches(input.rankerOrder, guesser.order);
    const penaltyApplied = guesser.pendingPenalties > 0;
    const awardedScore = penaltyApplied ? 0 : rawScore;

    return {
      playerId: guesser.playerId,
      submitted,
      rawScore,
      awardedScore,
      penaltyApplied,
      // Every matched position is a point for the group; every missed one, a point for
      // the game. A non-submitter and a penalised player both hand over all five.
      groupPointsDelta: awardedScore,
      gamePointsDelta: CARDS_PER_TURN - awardedScore,
    };
  });

  const groupPoints = perPlayer.reduce((sum, p) => sum + p.groupPointsDelta, 0);
  const eligibleGuessers = perPlayer.length;
  const possiblePoints = eligibleGuessers * CARDS_PER_TURN;

  return {
    perPlayer,
    eligibleGuessers,
    possiblePoints,
    groupPoints,
    gamePoints: possiblePoints - groupPoints,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Running standings
// ---------------------------------------------------------------------------

export type PlayerStanding = {
  playerId: string;
  displayName: string;
  totalScore: number;
  /** Denominator for the average. Counts every turn the player was an eligible Guesser,
   *  including turns they scored zero on — whether from a bad guess, no submission at
   *  all, or a skip penalty. Excludes their own Ranker turns and every turn that
   *  happened before they joined. */
  scoredGuesserTurns: number;
  rankerTurnsCompleted: number;
  rankerTurnsSkipped: number;
  pendingPenalties: number;
  consumedPenalties: number;
};

/** null (rendered as "—") until the player has actually played a Guesser turn. */
export function averageScore(standing: {
  totalScore: number;
  scoredGuesserTurns: number;
}): number | null {
  if (standing.scoredGuesserTurns <= 0) return null;
  return standing.totalScore / standing.scoredGuesserTurns;
}

/** Two decimal places for display; the exact value is kept everywhere else. */
export function formatAverage(average: number | null, emptyLabel = '—'): string {
  if (average === null) return emptyLabel;
  return average.toFixed(2);
}

/**
 * Fold one turn's result into a player's running standing, consuming exactly one pending
 * penalty when one was applied. Mirrors the UPDATE in `_score_turn`.
 */
export function applyTurnToStanding(
  standing: PlayerStanding,
  score: GuesserTurnScore,
): PlayerStanding {
  return {
    ...standing,
    totalScore: standing.totalScore + score.awardedScore,
    scoredGuesserTurns: standing.scoredGuesserTurns + 1,
    pendingPenalties: score.penaltyApplied
      ? Math.max(0, standing.pendingPenalties - 1)
      : standing.pendingPenalties,
    consumedPenalties: score.penaltyApplied
      ? standing.consumedPenalties + 1
      : standing.consumedPenalties,
  };
}

/** A Ranker who abandons their turn owes one forced zero on a future Guesser turn. */
export function applySkipToStanding(standing: PlayerStanding): PlayerStanding {
  return {
    ...standing,
    rankerTurnsSkipped: standing.rankerTurnsSkipped + 1,
    pendingPenalties: standing.pendingPenalties + 1,
  };
}

// ---------------------------------------------------------------------------
// Cooperative outcome
// ---------------------------------------------------------------------------

export type CooperativeVerdict = 'group' | 'draw' | 'game';

export function cooperativeVerdict(groupPoints: number, gamePoints: number): CooperativeVerdict {
  if (groupPoints > gamePoints) return 'group';
  if (groupPoints === gamePoints) return 'draw';
  return 'game';
}

/** null when no positions were ever at stake (for example a game of nothing but skips). */
export function groupSuccessPercent(groupPoints: number, possiblePoints: number): number | null {
  if (possiblePoints <= 0) return null;
  return (groupPoints * 100) / possiblePoints;
}
