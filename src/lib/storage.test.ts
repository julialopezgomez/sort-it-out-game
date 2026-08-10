import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalDictionary,
  loadLocalDictionary,
  localDictionaryCount,
  localDictionaryForUpload,
  mergeIntoLocalDictionary,
  removeFromLocalDictionary,
} from './localDictionary';
import {
  deleteHistoryEntry,
  historyAsCsv,
  historyAsJson,
  loadHistory,
  saveHistoryEntry,
} from './localHistory';
import { forgetMembership, getSessionToken, readMembership, rememberMembership } from './session';
import type { GameSummary } from './schemas';

beforeEach(() => {
  window.localStorage.clear();
  clearLocalDictionary();
});

describe('the invisible browser credential', () => {
  it('is created on first use and then stays stable', () => {
    const first = getSessionToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(getSessionToken()).toBe(first);
  });

  it('is never something the player has to see or type', () => {
    // The only public surface is the room code plus a display name.
    rememberMembership({ roomCode: 'ABCDEF', displayName: 'Ana', isHost: true });
    const membership = readMembership();
    expect(membership?.roomCode).toBe('ABCDEF');
    expect(membership?.displayName).toBe('Ana');
    expect(JSON.stringify(membership)).not.toContain(getSessionToken());
  });

  it('forgets a membership on request', () => {
    rememberMembership({ roomCode: 'ABCDEF', displayName: 'Ana', isHost: false });
    forgetMembership();
    expect(readMembership()).toBeNull();
  });
});

describe('the Host’s private dictionary', () => {
  it('starts empty', () => {
    expect(loadLocalDictionary()).toEqual([]);
    expect(localDictionaryCount()).toBe(0);
  });

  it('merges new cards and skips normalized duplicates', () => {
    expect(mergeIntoLocalDictionary([{ en: 'Board games', es: null }])).toBe(1);
    expect(mergeIntoLocalDictionary([{ en: '  BOARD   games ', es: '' }])).toBe(0);
    expect(mergeIntoLocalDictionary([{ en: 'Board games', es: 'Juegos de mesa' }])).toBe(1);

    expect(localDictionaryCount()).toBe(2);
  });

  it('drops cards with no text at all', () => {
    expect(mergeIntoLocalDictionary([{ en: '', es: '   ' }])).toBe(0);
    expect(localDictionaryCount()).toBe(0);
  });

  it('offers the dictionary in the shape create_room wants', () => {
    mergeIntoLocalDictionary([{ en: 'Board games', es: null }]);
    expect(localDictionaryForUpload()).toEqual([{ en: 'Board games', es: null }]);
  });

  it('can remove a single card', () => {
    mergeIntoLocalDictionary([
      { en: 'Board games', es: null },
      { en: null, es: 'La siesta' },
    ]);
    removeFromLocalDictionary('board games', null);
    expect(loadLocalDictionary().map((c) => c.es)).toEqual(['La siesta']);
  });

  it('survives corrupted storage without throwing', () => {
    window.localStorage.setItem('sortitout.dictionary.v1', 'not json at all');
    expect(loadLocalDictionary()).toEqual([]);
  });
});

function summary(overrides: Partial<GameSummary> = {}): GameSummary {
  return {
    gameId: 'game-1',
    roomCode: 'ABCDEF',
    createdAt: '2026-08-01T10:00:00.000Z',
    startedAt: '2026-08-01T10:05:00.000Z',
    finishedAt: '2026-08-01T10:40:00.000Z',
    settings: { totalCycles: 2, rankerSeconds: 45, guesserSeconds: 60, allowManualCards: true },
    cyclesCompleted: 2,
    scoredTurns: 6,
    cooperative: {
      groupPoints: 18,
      gamePoints: 12,
      possiblePoints: 30,
      groupSuccessPercent: 60,
      verdict: 'group',
    },
    players: [
      {
        playerId: 'p1',
        displayName: 'Ana',
        totalScore: 12,
        scoredGuesserTurns: 4,
        average: 3,
        rankerTurnsCompleted: 2,
        rankerTurnsSkipped: 0,
        pendingPenalties: 0,
        consumedPenalties: 0,
        totalPlace: 1,
        averagePlace: 1,
      },
      {
        playerId: 'p2',
        displayName: 'Ben, Jr.',
        totalScore: 6,
        scoredGuesserTurns: 4,
        average: 1.5,
        rankerTurnsCompleted: 1,
        rankerTurnsSkipped: 1,
        pendingPenalties: 0,
        consumedPenalties: 1,
        totalPlace: 2,
        averagePlace: 2,
      },
    ],
    ...overrides,
  };
}

describe('Host history in the Host’s browser', () => {
  it('saves and lists completed games, newest first', () => {
    saveHistoryEntry(summary({ gameId: 'game-1', roomCode: 'AAAAAA' }));
    saveHistoryEntry(summary({ gameId: 'game-2', roomCode: 'BBBBBB' }));

    const entries = loadHistory();
    expect(entries.map((e) => e.roomCode)).toEqual(['BBBBBB', 'AAAAAA']);
    expect(entries[0]?.playerNames).toEqual(['Ana', 'Ben, Jr.']);
  });

  it('replaces an entry rather than duplicating it', () => {
    saveHistoryEntry(summary({ gameId: 'game-1' }));
    saveHistoryEntry(summary({ gameId: 'game-1' }));
    expect(loadHistory()).toHaveLength(1);
  });

  it('deletes a single record on request', () => {
    saveHistoryEntry(summary({ gameId: 'game-1' }));
    saveHistoryEntry(summary({ gameId: 'game-2' }));
    deleteHistoryEntry('game-1');
    expect(loadHistory().map((e) => e.gameId)).toEqual(['game-2']);
  });

  it('exports JSON', () => {
    saveHistoryEntry(summary());
    const parsed: unknown = JSON.parse(historyAsJson());
    expect(parsed).toHaveProperty('games');
  });

  it('exports one CSV row per player, with a BOM and proper quoting', () => {
    saveHistoryEntry(summary());
    const csv = historyAsCsv();

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('room_code,finished_at,player');
    // A name containing a comma must be quoted.
    expect(csv).toContain('"Ben, Jr."');
    // Two players -> header plus two rows.
    expect(csv.trim().split('\r\n')).toHaveLength(3);
    expect(csv).toContain('3.00');
  });

  it('collects no analytics and no personal data beyond what players typed', () => {
    saveHistoryEntry(summary());
    const raw = window.localStorage.getItem('sortitout.history.v1') ?? '';
    for (const forbidden of ['@', 'ipAddress', 'userAgent', 'email']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});
