/**
 * Ranker rotation and cycle bookkeeping.
 *
 * Mirrors `_begin_next_turn` in supabase/migrations/0050_rpc_lobby.sql. The rule is
 * expressed as a search rather than as modular arithmetic, which is what lets a late
 * joiner slot into a cycle that is already under way:
 *
 *   the next Ranker is the lowest rotation_position who has not yet been Ranker
 *   in the current cycle.
 */

export type RotationPlayer = {
  playerId: string;
  rotationPosition: number;
};

export type PlayedTurn = {
  cycleNumber: number;
  rankerPlayerId: string;
};

export type NextTurnDecision =
  { kind: 'turn'; rankerPlayerId: string; cycleNumber: number } | { kind: 'finished' };

export function nextRanker(args: {
  players: readonly RotationPlayer[];
  played: readonly PlayedTurn[];
  currentCycle: number;
  totalCycles: number;
}): NextTurnDecision {
  const { players, played, totalCycles } = args;
  if (players.length === 0) return { kind: 'finished' };

  const cycle = Math.max(args.currentCycle, 1);
  const byPosition = [...players].sort((a, b) => a.rotationPosition - b.rotationPosition);

  const remaining = byPosition.filter(
    (player) =>
      !played.some((t) => t.cycleNumber === cycle && t.rankerPlayerId === player.playerId),
  );

  const candidate = remaining[0];
  if (candidate) {
    return { kind: 'turn', rankerPlayerId: candidate.playerId, cycleNumber: cycle };
  }

  // Everyone in this cycle has had a turn.
  if (args.currentCycle >= totalCycles) return { kind: 'finished' };

  const first = byPosition[0];
  if (!first) return { kind: 'finished' };
  return { kind: 'turn', rankerPlayerId: first.playerId, cycleNumber: args.currentCycle + 1 };
}

/**
 * The rotation order is randomized once, when the game starts. Randomizing the order is
 * what makes the *first* Ranker random; in the real game this happens in the database so
 * no browser gets to choose.
 */
export function shuffledRotation(
  playerIds: readonly string[],
  random: () => number = Math.random,
): RotationPlayer[] {
  const ids = [...playerIds];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = ids[i];
    const b = ids[j];
    if (a === undefined || b === undefined) continue;
    ids[i] = b;
    ids[j] = a;
  }
  return ids.map((playerId, index) => ({ playerId, rotationPosition: index + 1 }));
}

/** A player joining mid-game is appended, so they close out the cycle in progress. */
export function joinRotationPosition(rotationSize: number): number {
  return rotationSize + 1;
}

/**
 * A player owes a guess on a turn only if the turn started after they arrived.
 * `eligibleFromTurn` is the turn number that was in progress when they joined.
 */
export function isEligibleGuesser(
  player: { playerId: string; eligibleFromTurn: number },
  turn: { turnNumber: number; rankerPlayerId: string },
): boolean {
  if (player.playerId === turn.rankerPlayerId) return false;
  return player.eligibleFromTurn < turn.turnNumber;
}

/** Shown in the lobby/player list as a "Joins next turn" badge. */
export function joinsNextTurn(
  player: { eligibleFromTurn: number },
  currentTurnNumber: number,
): boolean {
  return currentTurnNumber > 0 && player.eligibleFromTurn >= currentTurnNumber;
}

/** Total turns a full game will run to, assuming nobody joins or the roster is stable. */
export function totalTurnsFor(playerCount: number, totalCycles: number): number {
  return playerCount * totalCycles;
}
