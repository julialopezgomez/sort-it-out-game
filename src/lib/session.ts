/**
 * The invisible browser credential.
 *
 * There are no accounts, no passwords and no recovery codes in this game. What
 * distinguishes "this browser, still connected" from "somebody else typing the same name"
 * is a random token kept in localStorage. The player is never shown it, never asked to
 * copy it and never has to manage it. Only its sha256 hash reaches the database.
 *
 * If the token is lost (cleared storage, new device), the player simply rejoins with the
 * room code and their name — which works as soon as their old session counts as
 * disconnected. See docs/SECURITY.md for the tradeoff that implies.
 */

const STORAGE_KEY = 'sortitout.session.v1';

function randomToken(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Only reachable in exotic environments; still unguessable enough for a party game.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let memoryFallback: string | null = null;

/** The token for this browser, created on first use. */
export function getSessionToken(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 32) return existing;
    const token = randomToken();
    window.localStorage.setItem(STORAGE_KEY, token);
    return token;
  } catch {
    // Private browsing with storage disabled: keep a token for this tab's lifetime so
    // the player can still finish the game they are in.
    memoryFallback ??= randomToken();
    return memoryFallback;
  }
}

/** Used by tests and by the "start completely fresh" escape hatch. */
export function resetSessionToken(): string {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    memoryFallback = null;
  }
  return getSessionToken();
}

// ---------------------------------------------------------------------------
// Remembering how to get back into a room
// ---------------------------------------------------------------------------

const LAST_ROOM_KEY = 'sortitout.lastRoom.v1';

export type RoomMembership = {
  roomCode: string;
  displayName: string;
  isHost: boolean;
  savedAt: string;
};

/** Lets a refreshed or reopened tab offer "rejoin ABCDEF as Ana?" instead of a blank form. */
export function rememberMembership(membership: Omit<RoomMembership, 'savedAt'>): void {
  try {
    window.localStorage.setItem(
      LAST_ROOM_KEY,
      JSON.stringify({ ...membership, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* storage unavailable; reconnection still works by typing the code and name */
  }
}

export function readMembership(): RoomMembership | null {
  try {
    const raw = window.localStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'roomCode' in parsed &&
      'displayName' in parsed
    ) {
      const value = parsed as RoomMembership;
      if (typeof value.roomCode === 'string' && typeof value.displayName === 'string') {
        return value;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetMembership(): void {
  try {
    window.localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    /* nothing to do */
  }
}
