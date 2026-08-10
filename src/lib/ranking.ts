/**
 * Standard competition ranking.
 *
 * Ties share the better place and the next place is skipped, so four players can finish
 * 1st, 2nd, 2nd, 4th — never 1st, 2nd, 2nd, 3rd. This matches SQL's rank() window
 * function, which is what the database uses when it builds the final summary.
 */

export type Placed<T> = {
  item: T;
  /** 1-based shared place. */
  place: number;
};

/**
 * Ranks highest-score-first. A null score means "no score yet" (a player whose average is
 * still "—"); those sort last and all share the same final place.
 */
export function competitionRanking<T>(
  items: readonly T[],
  scoreOf: (item: T) => number | null,
  tieBreakLabel?: (item: T) => string,
): Placed<T>[] {
  const sorted = [...items].sort((a, b) => {
    const scoreA = scoreOf(a);
    const scoreB = scoreOf(b);

    if (scoreA === null && scoreB === null) return compareLabels(a, b, tieBreakLabel);
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return compareLabels(a, b, tieBreakLabel);
  });

  const placed: Placed<T>[] = [];
  let currentPlace = 0;
  let previousScore: number | null | undefined;

  sorted.forEach((item, index) => {
    const score = scoreOf(item);
    // A new place is only opened when the score actually changes; equal scores reuse the
    // place that was opened when the group started.
    if (index === 0 || !sameScore(score, previousScore)) {
      currentPlace = index + 1;
      previousScore = score;
    }
    placed.push({ item, place: currentPlace });
  });

  return placed;
}

function sameScore(a: number | null, b: number | null | undefined): boolean {
  if (b === undefined) return false;
  return a === b;
}

function compareLabels<T>(a: T, b: T, labelOf?: (item: T) => string): number {
  if (!labelOf) return 0;
  return labelOf(a).localeCompare(labelOf(b));
}

/** "1st / 2nd / 3rd" is English-only grammar, so places are localized as plain numerals. */
export function formatPlace(place: number): string {
  return String(place);
}
