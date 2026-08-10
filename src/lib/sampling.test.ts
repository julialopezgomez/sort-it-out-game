import { describe, expect, it } from 'vitest';
import {
  canChooseCustomCard,
  canRedrawCustomOnly,
  canStartGame,
  drawDistinct,
  replaceOneSlot,
} from './sampling';

const pool = Array.from({ length: 20 }, (_, i) => ({ canonicalId: `f:card-${i}` }));

describe('random redraw without duplicates', () => {
  it('draws five distinct cards', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const drawn = drawDistinct(pool, 5);
      expect(drawn).toHaveLength(5);
      expect(new Set(drawn.map((c) => c.canonicalId)).size).toBe(5);
    }
  });

  it('never draws a card that is already in play', () => {
    const inPlay = ['f:card-0', 'f:card-1', 'f:card-2', 'f:card-3'];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [drawn] = drawDistinct(pool, 1, inPlay);
      expect(inPlay).not.toContain(drawn?.canonicalId);
    }
  });

  it('refuses to draw more cards than the pool can supply', () => {
    expect(() => drawDistinct(pool.slice(0, 4), 5)).toThrow('NOT_ENOUGH_CARDS');
    // Four already in play leaves only one available, so five is impossible.
    expect(() => drawDistinct(pool.slice(0, 5), 5, ['f:card-0'])).toThrow('NOT_ENOUGH_CARDS');
  });

  it('can draw the whole pool when it is exactly the right size', () => {
    const exact = pool.slice(0, 5);
    const drawn = drawDistinct(exact, 5);
    expect(new Set(drawn.map((c) => c.canonicalId))).toEqual(
      new Set(exact.map((c) => c.canonicalId)),
    );
  });

  it('replaces one slot and leaves the other four alone', () => {
    const current = pool.slice(0, 5);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const next = replaceOneSlot(current, 2, pool);

      expect(next).toHaveLength(5);
      expect(new Set(next.map((c) => c.canonicalId)).size).toBe(5);
      // Untouched slots are identical.
      expect(next[0]).toEqual(current[0]);
      expect(next[1]).toEqual(current[1]);
      expect(next[3]).toEqual(current[3]);
      expect(next[4]).toEqual(current[4]);
      // The replacement is never one of the cards still on the table.
      const others = [current[0], current[1], current[3], current[4]].map((c) => c?.canonicalId);
      expect(others).not.toContain(next[2]?.canonicalId);
    }
  });

  it('does not mutate the current selection', () => {
    const current = pool.slice(0, 5);
    const snapshot = [...current];
    replaceOneSlot(current, 0, pool);
    expect(current).toEqual(snapshot);
  });
});

describe('preparation button availability', () => {
  it('enables custom-only redraw only above five custom cards', () => {
    expect(canRedrawCustomOnly(0)).toBe(false);
    expect(canRedrawCustomOnly(4)).toBe(false);
    // Exactly five is still unavailable: drawing 5 from 5 is not a redraw.
    expect(canRedrawCustomOnly(5)).toBe(false);
    expect(canRedrawCustomOnly(6)).toBe(true);
  });

  it('enables the custom-card picker only when an unused custom card exists', () => {
    expect(canChooseCustomCard(0)).toBe(false);
    expect(canChooseCustomCard(1)).toBe(true);
  });

  it('needs five cards in the pool before a game can start', () => {
    expect(canStartGame(4)).toBe(false);
    expect(canStartGame(5)).toBe(true);
  });
});
