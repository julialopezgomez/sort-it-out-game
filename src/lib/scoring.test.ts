import { describe, expect, it } from 'vitest';
import {
  applySkipToStanding,
  applyTurnToStanding,
  averageScore,
  cooperativeVerdict,
  countExactMatches,
  formatAverage,
  groupSuccessPercent,
  scoreTurn,
  type PlayerStanding,
} from './scoring';

const CARDS = ['a', 'b', 'c', 'd', 'e'];

function standing(overrides: Partial<PlayerStanding> = {}): PlayerStanding {
  return {
    playerId: 'p1',
    displayName: 'Ana',
    totalScore: 0,
    scoredGuesserTurns: 0,
    rankerTurnsCompleted: 0,
    rankerTurnsSkipped: 0,
    pendingPenalties: 0,
    consumedPenalties: 0,
    ...overrides,
  };
}

describe('exact-position scoring', () => {
  it('gives five for a perfect match', () => {
    expect(countExactMatches(CARDS, [...CARDS])).toBe(5);
  });

  it('gives zero for a cyclic shift, which has no fixed points', () => {
    expect(countExactMatches(CARDS, ['b', 'c', 'd', 'e', 'a'])).toBe(0);
  });

  it('scores only exact positions, not relative order', () => {
    // b and d are swapped; a, c and e are still in place.
    expect(countExactMatches(CARDS, ['a', 'd', 'c', 'b', 'e'])).toBe(3);
  });

  it('gives one for a full reversal of five cards (the middle card stays put)', () => {
    expect(countExactMatches(CARDS, ['e', 'd', 'c', 'b', 'a'])).toBe(1);
  });

  it('treats a missing submission as zero', () => {
    expect(countExactMatches(CARDS, null)).toBe(0);
  });
});

describe('cooperative scoring', () => {
  it('splits each position between the group and the game', () => {
    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [
        { playerId: 'p1', order: [...CARDS], pendingPenalties: 0 }, // 5
        { playerId: 'p2', order: ['a', 'd', 'c', 'b', 'e'], pendingPenalties: 0 }, // 3
      ],
    });

    expect(result.eligibleGuessers).toBe(2);
    expect(result.possiblePoints).toBe(10);
    expect(result.groupPoints).toBe(8);
    expect(result.gamePoints).toBe(2);
    expect(result.groupPoints + result.gamePoints).toBe(result.possiblePoints);
  });

  it('excludes the Ranker from the possible-points count', () => {
    // Three players, one is Ranker: only two guessers are passed in, so 10 not 15.
    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [
        { playerId: 'p2', order: [...CARDS], pendingPenalties: 0 },
        { playerId: 'p3', order: [...CARDS], pendingPenalties: 0 },
      ],
    });
    expect(result.possiblePoints).toBe(10);
  });

  it('hands the game all five points for a non-submitter', () => {
    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: null, pendingPenalties: 0 }],
    });

    expect(result.perPlayer[0]?.submitted).toBe(false);
    expect(result.perPlayer[0]?.awardedScore).toBe(0);
    expect(result.perPlayer[0]?.groupPointsDelta).toBe(0);
    expect(result.perPlayer[0]?.gamePointsDelta).toBe(5);
    expect(result.groupPoints).toBe(0);
    expect(result.gamePoints).toBe(5);
  });

  it('produces no points at all for a skipped Ranker turn', () => {
    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: 0 }],
      skipped: true,
    });

    expect(result.skipped).toBe(true);
    expect(result.possiblePoints).toBe(0);
    expect(result.groupPoints).toBe(0);
    expect(result.gamePoints).toBe(0);
    expect(result.perPlayer).toEqual([]);
  });

  it('decides the verdict by comparing the two totals', () => {
    expect(cooperativeVerdict(30, 20)).toBe('group');
    expect(cooperativeVerdict(25, 25)).toBe('draw');
    expect(cooperativeVerdict(10, 40)).toBe('game');
  });

  it('reports group success as a percentage of possible positions', () => {
    expect(groupSuccessPercent(15, 30)).toBe(50);
    expect(groupSuccessPercent(30, 30)).toBe(100);
    expect(groupSuccessPercent(0, 0)).toBeNull();
  });
});

describe('skipped-Ranker penalty', () => {
  it('is created by a skip and applied to the next eligible Guesser turn', () => {
    let ana = standing();
    ana = applySkipToStanding(ana);

    expect(ana.rankerTurnsSkipped).toBe(1);
    expect(ana.pendingPenalties).toBe(1);

    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: ana.pendingPenalties }],
    });

    const score = result.perPlayer[0]!;
    // The raw count is preserved so the reveal can explain the forced zero.
    expect(score.rawScore).toBe(5);
    expect(score.awardedScore).toBe(0);
    expect(score.penaltyApplied).toBe(true);
    // Cooperatively the penalised player counts as five game points.
    expect(score.groupPointsDelta).toBe(0);
    expect(score.gamePointsDelta).toBe(5);
  });

  it('is consumed exactly once, and the next turn scores normally', () => {
    let ana = applySkipToStanding(standing());

    const penalised = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: ana.pendingPenalties }],
    }).perPlayer[0]!;
    ana = applyTurnToStanding(ana, penalised);

    expect(ana.pendingPenalties).toBe(0);
    expect(ana.consumedPenalties).toBe(1);
    expect(ana.totalScore).toBe(0);
    expect(ana.scoredGuesserTurns).toBe(1);

    const normal = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: ana.pendingPenalties }],
    }).perPlayer[0]!;
    ana = applyTurnToStanding(ana, normal);

    expect(normal.penaltyApplied).toBe(false);
    expect(ana.totalScore).toBe(5);
    expect(ana.scoredGuesserTurns).toBe(2);
  });

  it('handles more than one pending penalty, one per eligible turn', () => {
    let ana = applySkipToStanding(applySkipToStanding(standing()));
    expect(ana.pendingPenalties).toBe(2);

    for (let turn = 0; turn < 3; turn += 1) {
      const score = scoreTurn({
        rankerOrder: CARDS,
        guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: ana.pendingPenalties }],
      }).perPlayer[0]!;
      ana = applyTurnToStanding(ana, score);
    }

    // Two forced zeroes, then one real score of five.
    expect(ana.consumedPenalties).toBe(2);
    expect(ana.pendingPenalties).toBe(0);
    expect(ana.totalScore).toBe(5);
    expect(ana.scoredGuesserTurns).toBe(3);
  });
});

describe('totals and averages', () => {
  it('shows an unknown average as "—" rather than 0.00', () => {
    expect(averageScore({ totalScore: 0, scoredGuesserTurns: 0 })).toBeNull();
    expect(formatAverage(null)).toBe('—');
  });

  it('formats to two decimal places while keeping the exact value', () => {
    const average = averageScore({ totalScore: 13, scoredGuesserTurns: 3 });
    expect(average).toBeCloseTo(4.333333, 5);
    expect(formatAverage(average)).toBe('4.33');
  });

  it('counts a zero from a bad guess in the denominator', () => {
    const score = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: ['b', 'c', 'd', 'e', 'a'], pendingPenalties: 0 }],
    }).perPlayer[0]!;
    const after = applyTurnToStanding(standing(), score);

    expect(after.totalScore).toBe(0);
    expect(after.scoredGuesserTurns).toBe(1);
    expect(formatAverage(averageScore(after))).toBe('0.00');
  });

  it('counts a zero from a missed deadline in the denominator', () => {
    const score = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: null, pendingPenalties: 0 }],
    }).perPlayer[0]!;
    const after = applyTurnToStanding(standing(), score);

    expect(after.scoredGuesserTurns).toBe(1);
    expect(formatAverage(averageScore(after))).toBe('0.00');
  });

  it('does not count a player’s own Ranker turns in their denominator', () => {
    // A Ranker is simply absent from the guessers list, so nothing is folded in.
    const result = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p2', order: [...CARDS], pendingPenalties: 0 }],
    });
    expect(result.perPlayer.some((p) => p.playerId === 'p1')).toBe(false);

    const ranker = standing({ totalScore: 7, scoredGuesserTurns: 2, rankerTurnsCompleted: 1 });
    expect(averageScore(ranker)).toBe(3.5);
  });
});

describe('idempotent scoring', () => {
  it('is a pure function of its inputs, so repeating it changes nothing', () => {
    const input = {
      rankerOrder: CARDS,
      guessers: [
        { playerId: 'p1', order: [...CARDS], pendingPenalties: 0 },
        { playerId: 'p2', order: null, pendingPenalties: 1 },
      ],
    };
    expect(scoreTurn(input)).toEqual(scoreTurn(input));
  });

  it('folds a turn into a standing exactly once per call', () => {
    const score = scoreTurn({
      rankerOrder: CARDS,
      guessers: [{ playerId: 'p1', order: [...CARDS], pendingPenalties: 0 }],
    }).perPlayer[0]!;

    const once = applyTurnToStanding(standing(), score);
    expect(once.totalScore).toBe(5);
    expect(once.scoredGuesserTurns).toBe(1);
    // The database guards against a second application with score_events; this test
    // documents that the pure helper itself is not self-guarding.
    const twice = applyTurnToStanding(once, score);
    expect(twice.totalScore).toBe(10);
  });
});
