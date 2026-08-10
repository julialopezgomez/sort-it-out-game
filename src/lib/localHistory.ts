import type { GameSummary } from './schemas';

/**
 * Host history, in the Host's browser.
 *
 * There are no accounts, so there is no such thing as "my games" on a server. Completed
 * results do live in Supabase (retrievable with a known room code), but *discovering* them
 * relies on this local index. Clearing browser storage loses the index — that is stated
 * plainly in the UI and the README rather than being papered over, and there is no promise
 * of cross-device sync.
 *
 * Nothing here is analytics. It is the room code, the date, and the scores of a game the
 * Host ran.
 */

const STORAGE_KEY = 'sortitout.history.v1';
const MAX_ENTRIES = 100;

export type HistoryEntry = {
  roomCode: string;
  gameId: string;
  savedAt: string;
  finishedAt: string | null;
  playerNames: string[];
  summary: GameSummary;
};

type StoredHistory = {
  version: number;
  entries: HistoryEntry[];
};

function read(): StoredHistory {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'entries' in parsed &&
      Array.isArray((parsed as StoredHistory).entries)
    ) {
      return parsed as StoredHistory;
    }
    return { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function write(history: StoredHistory): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable: history is a convenience, not a requirement */
  }
}

export function saveHistoryEntry(summary: GameSummary): void {
  const history = read();
  const entry: HistoryEntry = {
    roomCode: summary.roomCode,
    gameId: summary.gameId,
    savedAt: new Date().toISOString(),
    finishedAt: summary.finishedAt,
    playerNames: summary.players.map((p) => p.displayName),
    summary,
  };

  const withoutDuplicate = history.entries.filter((e) => e.gameId !== summary.gameId);
  write({
    version: 1,
    entries: [entry, ...withoutDuplicate].slice(0, MAX_ENTRIES),
  });
}

export function loadHistory(): HistoryEntry[] {
  return read().entries;
}

export function deleteHistoryEntry(gameId: string): void {
  const history = read();
  write({ version: 1, entries: history.entries.filter((e) => e.gameId !== gameId) });
}

export function clearHistory(): void {
  write({ version: 1, entries: [] });
}

/** JSON export of the whole local history. */
export function historyAsJson(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), games: read().entries }, null, 2);
}

/** Flat CSV export: one row per player per game, which is what a spreadsheet wants. */
export function historyAsCsv(entries: readonly HistoryEntry[] = loadHistory()): string {
  const header = [
    'room_code',
    'finished_at',
    'player',
    'total_score',
    'scored_guesser_turns',
    'average',
    'total_place',
    'average_place',
    'ranker_turns_completed',
    'ranker_turns_skipped',
    'group_points',
    'game_points',
    'possible_points',
    'verdict',
  ];

  const escape = (value: string | number | null): string => {
    const text = value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [header.join(',')];
  for (const entry of entries) {
    const co = entry.summary.cooperative;
    for (const player of entry.summary.players) {
      lines.push(
        [
          entry.roomCode,
          entry.finishedAt ?? '',
          player.displayName,
          player.totalScore,
          player.scoredGuesserTurns,
          player.average === null ? '' : Number(player.average).toFixed(2),
          player.totalPlace,
          player.averagePlace,
          player.rankerTurnsCompleted,
          player.rankerTurnsSkipped,
          co.groupPoints,
          co.gamePoints,
          co.possiblePoints,
          co.verdict,
        ]
          .map(escape)
          .join(','),
      );
    }
  }

  // BOM for spreadsheet compatibility, same as the dictionary export.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
