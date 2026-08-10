import type { GameStateView } from '../../lib/schemas';
import type { ClockOffset } from '../../lib/time';
import type { LeaderboardRow } from '../../components/Leaderboards';

export type RoomViewProps = {
  state: GameStateView;
  roomCode: string;
  refresh: () => Promise<void>;
  offset?: ClockOffset | null;
};

/** The live leaderboard rows, straight from the authoritative player list. */
export function leaderboardRows(state: GameStateView): LeaderboardRow[] {
  return state.players.map((player) => ({
    playerId: player.playerId,
    displayName: player.displayName,
    totalScore: player.totalScore,
    scoredGuesserTurns: player.scoredGuesserTurns,
    average: player.average === null ? null : Number(player.average),
    rankerTurnsCompleted: player.rankerTurnsCompleted,
    rankerTurnsSkipped: player.rankerTurnsSkipped,
    consumedPenalties: player.consumedPenalties,
    pendingPenalties: player.pendingPenalties,
  }));
}

/** Turn and round heading, e.g. "Turn 5" / "Round 2 of 3". */
export function turnHeading(state: GameStateView): { turn: number; cycle: number; total: number } {
  return {
    turn: state.game.currentTurnNumber,
    cycle: state.game.currentCycle,
    total: state.game.totalCycles,
  };
}
