/**
 * Room codes.
 *
 * Six characters, generated in the database. O, 0, I and 1 are excluded so a code can be
 * read out over a noisy dinner table or copied from a photo without ambiguity. Codes are
 * case-insensitive for players: they are canonicalized to upper case before any lookup.
 */

export const ROOM_CODE_LENGTH = 6;

/** 32 unambiguous characters: A-Z without I and O, digits 2-9. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mirror of `_canonical_room_code`: strip anything that is not alphanumeric, upper-case. */
export function canonicalRoomCode(input: string | null | undefined): string {
  return (input ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function isValidRoomCode(input: string | null | undefined): boolean {
  const code = canonicalRoomCode(input);
  return code.length === ROOM_CODE_LENGTH;
}

/**
 * True when the code is the right length but contains a character the generator never
 * emits — almost always someone typing O for a zero-looking glyph. Worth a gentle hint
 * rather than a blunt "room not found".
 */
export function hasAmbiguousCharacters(input: string | null | undefined): boolean {
  const code = canonicalRoomCode(input);
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].some((char) => !ROOM_CODE_ALPHABET.includes(char));
}

/** Formatted for display: "ABC DEF" reads more easily out loud than "ABCDEF". */
export function formatRoomCode(code: string): string {
  const canonical = canonicalRoomCode(code);
  if (canonical.length !== ROOM_CODE_LENGTH) return canonical;
  return `${canonical.slice(0, 3)} ${canonical.slice(3)}`;
}

/** The shareable join link for a room, respecting the GitHub Pages base path. */
export function joinUrl(code: string, origin: string, basePath: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${origin}${base}#/join/${canonicalRoomCode(code)}`;
}
