import { describe, expect, it } from 'vitest';
import {
  isEligibleGuesser,
  joinRotationPosition,
  joinsNextTurn,
  nextRanker,
  shuffledRotation,
  totalTurnsFor,
  type PlayedTurn,
  type RotationPlayer,
} from './rotation';

const THREE: RotationPlayer[] = [
  { playerId: 'ana', rotationPosition: 1 },
  { playerId: 'ben', rotationPosition: 2 },
  { playerId: 'cleo', rotationPosition: 3 },
];

describe('fixed Ranker rotation', () => {
  it('follows rotation position in order', () => {
    const played: PlayedTurn[] = [];
    const order: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const decision = nextRanker({ players: THREE, played, currentCycle: 1, totalCycles: 2 });
      expect(decision.kind).toBe('turn');
      if (decision.kind !== 'turn') return;
      order.push(decision.rankerPlayerId);
      played.push({ cycleNumber: decision.cycleNumber, rankerPlayerId: decision.rankerPlayerId });
    }

    expect(order).toEqual(['ana', 'ben', 'cleo']);
  });

  it('starts the next cycle with the same order', () => {
    const played: PlayedTurn[] = [
      { cycleNumber: 1, rankerPlayerId: 'ana' },
      { cycleNumber: 1, rankerPlayerId: 'ben' },
      { cycleNumber: 1, rankerPlayerId: 'cleo' },
    ];

    const decision = nextRanker({ players: THREE, played, currentCycle: 1, totalCycles: 3 });
    expect(decision).toEqual({ kind: 'turn', rankerPlayerId: 'ana', cycleNumber: 2 });
  });

  it('counts a skipped turn as having been that player’s turn', () => {
    // A skip still creates a turn row, so the rotation moves on rather than retrying.
    const played: PlayedTurn[] = [{ cycleNumber: 1, rankerPlayerId: 'ana' }];
    const decision = nextRanker({ players: THREE, played, currentCycle: 1, totalCycles: 1 });
    expect(decision).toEqual({ kind: 'turn', rankerPlayerId: 'ben', cycleNumber: 1 });
  });
});

describe('cycle completion', () => {
  it('finishes once the configured cycles are all played', () => {
    const played: PlayedTurn[] = THREE.map((p) => ({ cycleNumber: 1, rankerPlayerId: p.playerId }));
    expect(nextRanker({ players: THREE, played, currentCycle: 1, totalCycles: 1 })).toEqual({
      kind: 'finished',
    });
  });

  it('runs players × cycles turns in a stable roster', () => {
    const players = THREE;
    const totalCycles = 3;
    const played: PlayedTurn[] = [];
    let cycle = 1;
    let turns = 0;

    for (let guard = 0; guard < 50; guard += 1) {
      const decision = nextRanker({ players, played, currentCycle: cycle, totalCycles });
      if (decision.kind === 'finished') break;
      cycle = decision.cycleNumber;
      played.push({ cycleNumber: cycle, rankerPlayerId: decision.rankerPlayerId });
      turns += 1;
    }

    expect(turns).toBe(totalTurnsFor(players.length, totalCycles));
    expect(turns).toBe(9);
  });

  it('finishes immediately when nobody is left', () => {
    expect(nextRanker({ players: [], played: [], currentCycle: 1, totalCycles: 5 })).toEqual({
      kind: 'finished',
    });
  });
});

describe('random first Ranker', () => {
  it('assigns every player a distinct rotation position', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const rotation = shuffledRotation(ids);

    expect(rotation).toHaveLength(5);
    expect(new Set(rotation.map((r) => r.rotationPosition))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(rotation.map((r) => r.playerId))).toEqual(new Set(ids));
  });

  it('is driven purely by the supplied randomness, so the first Ranker really can be anyone', () => {
    const ids = ['a', 'b', 'c'];
    // A generator that always returns 0 reverses in a predictable way; the point is only
    // that the outcome depends on the source of randomness rather than on join order.
    const alwaysZero = shuffledRotation(ids, () => 0);
    const alwaysHigh = shuffledRotation(ids, () => 0.999999);

    expect(alwaysZero.map((r) => r.playerId)).not.toEqual(alwaysHigh.map((r) => r.playerId));
  });

  it('spreads the first position across players over many shuffles', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const firsts = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const rotation = shuffledRotation(ids);
      const first = rotation.find((r) => r.rotationPosition === 1);
      if (first) firsts.add(first.playerId);
    }
    expect(firsts.size).toBe(4);
  });
});

describe('late joining', () => {
  it('appends the new player to the end of the rotation', () => {
    expect(joinRotationPosition(3)).toBe(4);
  });

  it('does not make them a Guesser on the turn already in progress', () => {
    // Dave joined while turn 2 was running, so eligibleFromTurn is 2.
    const dave = { playerId: 'dave', eligibleFromTurn: 2 };

    expect(isEligibleGuesser(dave, { turnNumber: 2, rankerPlayerId: 'ana' })).toBe(false);
    expect(isEligibleGuesser(dave, { turnNumber: 3, rankerPlayerId: 'ana' })).toBe(true);
  });

  it('never makes the Ranker a Guesser on their own turn', () => {
    const ana = { playerId: 'ana', eligibleFromTurn: 0 };
    expect(isEligibleGuesser(ana, { turnNumber: 4, rankerPlayerId: 'ana' })).toBe(false);
    expect(isEligibleGuesser(ana, { turnNumber: 4, rankerPlayerId: 'ben' })).toBe(true);
  });

  it('shows a "joins next turn" badge until a playable turn begins', () => {
    expect(joinsNextTurn({ eligibleFromTurn: 2 }, 2)).toBe(true);
    expect(joinsNextTurn({ eligibleFromTurn: 2 }, 3)).toBe(false);
    // Nobody is "joining next turn" while the game is still in the lobby.
    expect(joinsNextTurn({ eligibleFromTurn: 0 }, 0)).toBe(false);
  });

  it('still gives a late joiner a Ranker turn at the end of the current cycle', () => {
    const players: RotationPlayer[] = [...THREE, { playerId: 'dave', rotationPosition: 4 }];
    // Dave arrived during the final cycle, after the other three had all been Ranker.
    const played: PlayedTurn[] = THREE.map((p) => ({ cycleNumber: 2, rankerPlayerId: p.playerId }));

    const decision = nextRanker({ players, played, currentCycle: 2, totalCycles: 2 });
    expect(decision).toEqual({ kind: 'turn', rankerPlayerId: 'dave', cycleNumber: 2 });
  });

  it('keeps the late joiner in that same place in later cycles', () => {
    const players: RotationPlayer[] = [...THREE, { playerId: 'dave', rotationPosition: 4 }];
    const played: PlayedTurn[] = [
      ...THREE.map((p) => ({ cycleNumber: 1, rankerPlayerId: p.playerId })),
      { cycleNumber: 1, rankerPlayerId: 'dave' },
    ];

    const order: string[] = [];
    let cycle = 1;
    for (let i = 0; i < 4; i += 1) {
      const decision = nextRanker({ players, played, currentCycle: cycle, totalCycles: 2 });
      if (decision.kind !== 'turn') break;
      cycle = decision.cycleNumber;
      order.push(decision.rankerPlayerId);
      played.push({ cycleNumber: cycle, rankerPlayerId: decision.rankerPlayerId });
    }

    expect(order).toEqual(['ana', 'ben', 'cleo', 'dave']);
  });
});
