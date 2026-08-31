import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import * as rpc from '../lib/rpc';
import { GameError, toGameError } from '../lib/errors';
import { computeClockOffset, parseServerTime, type ClockOffset } from '../lib/time';
import type { GameStateView } from '../lib/schemas';
import { HEARTBEAT_INTERVAL_MS } from '../lib/types';

/**
 * The one live connection to a room.
 *
 * Three independent loops keep a client honest:
 *
 *  1. Realtime — a subscription to public.room_events. Those messages carry no state, only
 *     "something changed". Every one of them triggers a refetch through get_game_state, so
 *     duplicate, out-of-order or missed events are all harmless.
 *  2. Heartbeat — every 10 seconds, so the room knows this player is still here.
 *  3. Advance — GitHub Pages cannot run a scheduler, so clients call the idempotent
 *     advance_game_if_needed. It is deliberately not a busy poll: the next check is
 *     scheduled for just after whatever the game is actually waiting on.
 *
 * The database is canonical throughout. Nothing here computes a score or decides whether a
 * deadline has passed.
 */

export type RoomConnection = {
  state: GameStateView | null;
  offset: ClockOffset | null;
  error: GameError | null;
  loading: boolean;
  realtimeConnected: boolean;
  /** Refetch immediately; also used by every action after it succeeds. */
  refresh: () => Promise<void>;
  /** Clears a transient error banner without touching the fetched state. */
  clearError: () => void;
};

const REALTIME_DEBOUNCE_MS = 120;
const PREPARING_POLL_MS = 8_000;
const PAUSED_POLL_MS = 5_000;
const DEADLINE_GRACE_MS = 700;
const MAX_POLL_MS = 15_000;
// An expired phase that is still expired: keep nudging, but slowly enough to stay well
// inside the server's rate limit for this player.
const EXPIRED_RETRY_MS = 1_000;

export function useGameRoom(roomCode: string | null): RoomConnection {
  const [state, setState] = useState<GameStateView | null>(null);
  const [offset, setOffset] = useState<ClockOffset | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const [loading, setLoading] = useState(roomCode !== null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Guards against an older in-flight response overwriting a newer one.
  const requestSeq = useRef(0);
  const latestApplied = useRef(0);
  const mounted = useRef(true);
  const stateRef = useRef<GameStateView | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!roomCode) return;
    const seq = ++requestSeq.current;

    try {
      const next = await rpc.getGameState(roomCode);
      if (!mounted.current || seq < latestApplied.current) return;
      latestApplied.current = seq;
      stateRef.current = next;
      setState(next);
      setOffset(computeClockOffset(next.serverNow));
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(toGameError(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [roomCode]);

  // ---------------------------------------------------------------- initial load
  useEffect(() => {
    if (!roomCode) {
      setState(null);
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setError(new GameError('NOT_CONFIGURED'));
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [roomCode, refresh]);

  // ---------------------------------------------------------------- realtime
  const gameId = state?.game.gameId ?? null;

  useEffect(() => {
    if (!roomCode || !gameId || !isSupabaseConfigured) return;

    let channel: RealtimeChannel | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      // Several events often land together (phase change plus submissions). One refetch
      // covers them all.
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void refresh();
      }, REALTIME_DEBOUNCE_MS);
    };

    channel = getSupabase()
      .channel(`room:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_events', filter: `game_id=eq.${gameId}` },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (!mounted.current) return;
        const connected = status === 'SUBSCRIBED';
        setRealtimeConnected(connected);
        // A fresh subscription may have missed events while it was down.
        if (connected) void refresh();
      });

    return () => {
      if (debounce) clearTimeout(debounce);
      if (channel) void getSupabase().removeChannel(channel);
      setRealtimeConnected(false);
    };
  }, [roomCode, gameId, refresh]);

  // ---------------------------------------------------------------- heartbeat
  useEffect(() => {
    if (!roomCode || !isSupabaseConfigured) return;
    if (state && ['finished', 'cancelled'].includes(state.game.phase)) return;

    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;
      try {
        const result = await rpc.heartbeat(roomCode);
        if (!cancelled && mounted.current) setOffset(computeClockOffset(result.serverNow));
      } catch (caught) {
        const gameError = toGameError(caught);
        // NOT_IN_ROOM means somebody else reclaimed this name; surface it so the UI can
        // offer to rejoin rather than silently pretending to still be connected.
        if (!cancelled && mounted.current && gameError.code === 'NOT_IN_ROOM') {
          setError(gameError);
        }
      }
    };

    void beat();
    const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomCode, state?.game.phase, state]);

  // ---------------------------------------------------------------- advance loop
  useEffect(() => {
    if (!roomCode || !stateRef.current || !isSupabaseConfigured) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;

      const latest = stateRef.current;
      if (!latest) return;

      const delay = nextAdvanceDelay(latest);
      if (delay === null) return;

      timer = setTimeout(() => {
        void (async () => {
          try {
            await rpc.advanceGameIfNeeded(roomCode);
          } catch {
            // A transient failure must not strand everyone on an expired phase. The
            // retry below keeps nudging until either this client or another one moves it.
          }

          try {
            await refresh();
          } catch {
            // refresh normally records its own error, but the scheduler must keep running
            // even when both requests fail during a brief loss of connectivity.
          }

          schedule();
        })();
      }, delay);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomCode, state?.game.phase, state?.game.deadlineAt, state?.game.pauseReason, refresh]);

  // ---------------------------------------------------------------- window events
  useEffect(() => {
    if (!roomCode) return;

    const onWake = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [roomCode, refresh]);

  const clearError = useCallback(() => setError(null), []);

  return { state, offset, error, loading, realtimeConnected, refresh, clearError };
}

/**
 * When should this client next nudge the game along? Returns null when there is nothing
 * the database could possibly need to decide.
 */
export function nextAdvanceDelay(state: GameStateView, nowMs = Date.now()): number | null {
  const { phase, deadlineAt, pauseReason } = state.game;

  if (['lobby', 'finished', 'cancelled'].includes(phase)) return null;

  if (phase === 'paused') {
    // Only a disconnect pause can end by itself, when the Ranker comes back.
    return pauseReason === 'ranker_disconnected' ? PAUSED_POLL_MS : null;
  }

  // Card preparation is untimed, but the Ranker might vanish during it.
  if (phase === 'preparing_cards') return PREPARING_POLL_MS;

  const deadlineMs = parseServerTime(deadlineAt);
  if (deadlineMs !== null) {
    // Measured against the server's own clock, so a wrong browser clock cannot skew this.
    // If that timestamp is ever unreadable we still schedule a check off the local clock:
    // an unparseable string must never be the reason a timed phase stops advancing.
    const serverNowMs = parseServerTime(state.serverNow) ?? nowMs;
    const untilDeadline = deadlineMs - serverNowMs;
    if (untilDeadline > 0) return Math.min(MAX_POLL_MS, untilDeadline + DEADLINE_GRACE_MS);
    return EXPIRED_RETRY_MS;
  }

  // Unlimited ordering phase: nothing to expire. The Ranker being away is handled above,
  // and a slow Guesser is the Host's problem to pause or skip.
  if (phase === 'ranker_ordering' || phase === 'guessers_ordering') {
    return state.turn?.rankerConnected === false ? PAUSED_POLL_MS : null;
  }

  if (phase === 'next_turn') return 500;
  return null;
}
