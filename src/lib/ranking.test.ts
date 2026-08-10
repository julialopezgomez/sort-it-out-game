import { describe, expect, it } from 'vitest';
import { competitionRanking } from './ranking';
import { averageScore } from './scoring';

type Row = { name: string; total: number; turns: number };

describe('standard competition ranking', () => {
  it('gives 1st, 2nd, 2nd, 4th — never 1st, 2nd, 2nd, 3rd', () => {
    const rows: Row[] = [
      { name: 'Ana', total: 12, turns: 3 },
      { name: 'Ben', total: 9, turns: 3 },
      { name: 'Cleo', total: 9, turns: 3 },
      { name: 'Dan', total: 4, turns: 3 },
    ];

    const placed = competitionRanking(
      rows,
      (r) => r.total,
      (r) => r.name,
    );

    expect(placed.map((p) => [p.item.name, p.place])).toEqual([
      ['Ana', 1],
      ['Ben', 2],
      ['Cleo', 2],
      ['Dan', 4],
    ]);
  });

  it('handles a three-way tie at the top', () => {
    const rows: Row[] = [
      { name: 'Ana', total: 10, turns: 2 },
      { name: 'Ben', total: 10, turns: 2 },
      { name: 'Cleo', total: 10, turns: 2 },
      { name: 'Dan', total: 1, turns: 2 },
    ];
    expect(
      competitionRanking(
        rows,
        (r) => r.total,
        (r) => r.name,
      ).map((p) => p.place),
    ).toEqual([1, 1, 1, 4]);
  });

  it('gives everyone first place when all scores are equal', () => {
    const rows: Row[] = [
      { name: 'Ana', total: 5, turns: 1 },
      { name: 'Ben', total: 5, turns: 1 },
    ];
    expect(competitionRanking(rows, (r) => r.total).map((p) => p.place)).toEqual([1, 1]);
  });

  it('ranks by average independently of total', () => {
    // Dan joined late: fewer turns, but a better average.
    const rows: Row[] = [
      { name: 'Ana', total: 12, turns: 4 }, // 3.00
      { name: 'Dan', total: 8, turns: 2 }, // 4.00
    ];

    const byTotal = competitionRanking(rows, (r) => r.total).map((p) => p.item.name);
    const byAverage = competitionRanking(rows, (r) =>
      averageScore({ totalScore: r.total, scoredGuesserTurns: r.turns }),
    ).map((p) => p.item.name);

    expect(byTotal).toEqual(['Ana', 'Dan']);
    expect(byAverage).toEqual(['Dan', 'Ana']);
  });

  it('sorts players with no average yet to the end, sharing one place', () => {
    const rows: Row[] = [
      { name: 'Ana', total: 6, turns: 2 },
      { name: 'New1', total: 0, turns: 0 },
      { name: 'New2', total: 0, turns: 0 },
      { name: 'Ben', total: 8, turns: 2 },
    ];

    const placed = competitionRanking(
      rows,
      (r) => averageScore({ totalScore: r.total, scoredGuesserTurns: r.turns }),
      (r) => r.name,
    );

    expect(placed.map((p) => [p.item.name, p.place])).toEqual([
      ['Ben', 1],
      ['Ana', 2],
      ['New1', 3],
      ['New2', 3],
    ]);
  });

  it('returns an empty list unchanged', () => {
    expect(competitionRanking([], () => 0)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const rows: Row[] = [
      { name: 'Ana', total: 1, turns: 1 },
      { name: 'Ben', total: 9, turns: 1 },
    ];
    const snapshot = [...rows];
    competitionRanking(rows, (r) => r.total);
    expect(rows).toEqual(snapshot);
  });
});
