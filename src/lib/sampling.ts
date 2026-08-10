import { CARDS_PER_TURN } from './types';

/**
 * Card sampling.
 *
 * The real draw happens in `_fill_slots` (supabase/migrations/0040_helpers.sql), which is
 * the only place allowed to decide what is on the table — a modified browser cannot
 * nominate a card. These functions express the same rules for tests, and answer the
 * UI's questions about which preparation buttons should be enabled.
 */

export type PoolCard = { canonicalId: string };

/**
 * Draw `count` distinct cards from `pool`, excluding anything already in play.
 * Throws rather than returning a short hand: five slots must always be filled.
 */
export function drawDistinct<T extends PoolCard>(
  pool: readonly T[],
  count: number,
  exclude: readonly string[] = [],
  random: () => number = Math.random,
): T[] {
  const excluded = new Set(exclude);
  const candidates = pool.filter((card) => !excluded.has(card.canonicalId));

  if (candidates.length < count) {
    throw new Error('NOT_ENOUGH_CARDS');
  }

  // Partial Fisher-Yates: shuffle only as far as we need to.
  const working = [...candidates];
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (working.length - i));
    const a = working[i];
    const b = working[j];
    if (a === undefined || b === undefined) break;
    working[i] = b;
    working[j] = a;
    picked.push(b);
  }
  return picked;
}

/** Replace exactly one slot, keeping the other four untouched and unduplicated. */
export function replaceOneSlot<T extends PoolCard>(
  current: readonly T[],
  slotIndex: number,
  pool: readonly T[],
  random: () => number = Math.random,
): T[] {
  const keep = current.filter((_, index) => index !== slotIndex);
  const [replacement] = drawDistinct(
    pool,
    1,
    keep.map((card) => card.canonicalId),
    random,
  );
  if (!replacement) throw new Error('NOT_ENOUGH_CARDS');

  return current.map((card, index) => (index === slotIndex ? replacement : card));
}

/**
 * "Redraw custom only" is offered only when there are MORE than five enabled custom
 * cards. With exactly five there is no choice to make, and a button that cannot change
 * anything is worse than a button that explains why it is unavailable.
 */
export function canRedrawCustomOnly(distinctEnabledCustomCards: number): boolean {
  return distinctEnabledCustomCards > CARDS_PER_TURN;
}

/** "Choose custom card" needs at least one custom card that is not already on the table. */
export function canChooseCustomCard(unusedCustomCards: number): boolean {
  return unusedCustomCards > 0;
}

/** A turn can only start when the combined pool can fill five distinct slots. */
export function canStartGame(totalEnabledCards: number): boolean {
  return totalEnabledCards >= CARDS_PER_TURN;
}
