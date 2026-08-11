import { z } from 'zod';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { GameError, toGameError } from './errors';
import { getSessionToken } from './session';
import { canonicalRoomCode } from './roomCode';
import {
  advanceSchema,
  createResultSchema,
  customCardListSchema,
  dictionaryExportSchema,
  displayNameSchema,
  gameStateSchema,
  heartbeatSchema,
  importResultSchema,
  joinResultSchema,
  orderSchema,
  previousTurnCardSetListSchema,
  settingsSchema,
  summarySchema,
  type CreateResult,
  type GameStateView,
  type GameSummary,
  type ImportResult,
  type JoinResult,
  type PreviousTurnCardSet,
} from './schemas';
import type { GameSettings, Language } from './types';

/**
 * Typed wrappers around the database RPCs.
 *
 * Every call sends the invisible session token; nothing else identifies the player. Every
 * response is parsed with zod, and every failure is normalized into a GameError carrying a
 * localizable code.
 */

/** Small response shapes that are not worth a named export. */
const okSchema = z.object({ ok: z.boolean() }).passthrough();
const languageEchoSchema = z.object({ language: z.string() });
const manualCardSchema = z.object({ ok: z.boolean(), created: z.boolean(), cardId: z.string() });
const skipSchema = z.object({ ok: z.boolean(), kind: z.enum(['voluntary', 'host_disconnected']) });
const endGameSchema = z.object({ phase: z.string() });
const playAgainSchema = z.object({ roomCode: z.string(), reused: z.boolean() });

async function call<TSchema extends z.ZodTypeAny>(
  fn: string,
  args: Record<string, unknown>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  if (!isSupabaseConfigured) {
    throw new GameError('NOT_CONFIGURED');
  }

  try {
    const { data, error } = await getSupabase().rpc(fn, args);
    if (error) throw toGameError(error);

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      // A shape mismatch means the deployed migrations are older or newer than this
      // bundle. Surfacing it as a service problem points the owner at the right fix.
      console.error(`Unexpected response from ${fn}`, parsed.error.issues);
      throw new GameError('SERVICE_UNAVAILABLE', parsed.error);
    }
    return parsed.data;
  } catch (error) {
    throw toGameError(error);
  }
}

function room(code: string): string {
  return canonicalRoomCode(code);
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export async function createRoom(input: {
  displayName: string;
  language: Language;
  settings: GameSettings;
  customCards?: { en: string | null; es: string | null }[];
}): Promise<CreateResult> {
  const displayName = displayNameSchema.parse(input.displayName);
  const settings = settingsSchema.parse(input.settings);
  const cards = customCardListSchema.parse(input.customCards ?? []);

  return call(
    'create_room',
    {
      p_session_token: getSessionToken(),
      p_display_name: displayName,
      p_language: input.language,
      p_settings: settings,
      p_custom_cards: cards,
    },
    createResultSchema,
  );
}

export async function joinRoom(input: {
  roomCode: string;
  displayName: string;
  language: Language;
}): Promise<JoinResult> {
  const displayName = displayNameSchema.parse(input.displayName);
  return call(
    'join_room',
    {
      p_room_code: room(input.roomCode),
      p_session_token: getSessionToken(),
      p_display_name: displayName,
      p_language: input.language,
    },
    joinResultSchema,
  );
}

export async function heartbeat(roomCode: string) {
  return call(
    'heartbeat',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    heartbeatSchema,
  );
}

export async function setLanguage(roomCode: string, language: Language) {
  return call(
    'set_player_language',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_language: language },
    // The RPC echoes the language back; we only care that it succeeded.
    languageEchoSchema,
  );
}

export async function updateSettings(roomCode: string, settings: GameSettings) {
  const parsed = settingsSchema.parse(settings);
  return call(
    'update_settings',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_settings: parsed },
    okSchema,
  );
}

export async function importCustomCards(
  roomCode: string,
  cards: { en: string | null; es: string | null }[],
): Promise<ImportResult> {
  const parsed = customCardListSchema.parse(cards);
  return call(
    'import_custom_cards',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_cards: parsed },
    importResultSchema,
  );
}

export async function startGame(roomCode: string) {
  return call(
    'start_game',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

// ---------------------------------------------------------------------------
// Card preparation
// ---------------------------------------------------------------------------

export async function replaceCardRandom(roomCode: string, slot: number) {
  return call(
    'replace_card_random',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_slot: slot },
    okSchema,
  );
}

export async function chooseCustomCard(roomCode: string, slot: number, customCardId: string) {
  return call(
    'choose_custom_card',
    {
      p_room_code: room(roomCode),
      p_session_token: getSessionToken(),
      p_slot: slot,
      p_custom_card_id: customCardId,
    },
    okSchema,
  );
}

export async function createManualCard(
  roomCode: string,
  slot: number,
  textEn: string | null,
  textEs: string | null,
) {
  return call(
    'create_manual_card',
    {
      p_room_code: room(roomCode),
      p_session_token: getSessionToken(),
      p_slot: slot,
      p_text_en: textEn,
      p_text_es: textEs,
    },
    manualCardSchema,
  );
}

export async function redrawAllCards(roomCode: string) {
  return call(
    'redraw_all_cards',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function redrawCustomCards(roomCode: string) {
  return call(
    'redraw_custom_cards',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function acceptCards(roomCode: string) {
  return call(
    'accept_cards',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function listPreviousTurnCardSets(roomCode: string): Promise<PreviousTurnCardSet[]> {
  return call(
    'list_previous_turn_card_sets',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    previousTurnCardSetListSchema,
  );
}

export async function repeatPreviousTurnCards(roomCode: string, sourceTurnId: string) {
  return call(
    'repeat_previous_turn_cards',
    {
      p_room_code: room(roomCode),
      p_session_token: getSessionToken(),
      p_source_turn_id: sourceTurnId,
    },
    okSchema,
  );
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export async function persistRanking(roomCode: string, order: string[]) {
  const parsed = orderSchema.parse(order);
  return call(
    'persist_ranking',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_order: parsed },
    okSchema,
  );
}

export async function submitRanking(roomCode: string, order: string[]) {
  const parsed = orderSchema.parse(order);
  return call(
    'submit_ranking',
    { p_room_code: room(roomCode), p_session_token: getSessionToken(), p_order: parsed },
    okSchema,
  );
}

// ---------------------------------------------------------------------------
// Host controls and the scheduler
// ---------------------------------------------------------------------------

export async function pauseGame(roomCode: string) {
  return call(
    'pause_game',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function resumeGame(roomCode: string) {
  return call(
    'resume_game',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function skipRankerTurn(roomCode: string) {
  return call(
    'skip_ranker_turn',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    skipSchema,
  );
}

export async function advanceGameIfNeeded(roomCode: string) {
  return call(
    'advance_game_if_needed',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    advanceSchema,
  );
}

export async function advanceRevealNow(roomCode: string) {
  return call(
    'advance_reveal_now',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}

export async function endGame(roomCode: string) {
  return call(
    'end_game',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    endGameSchema,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getGameState(roomCode: string): Promise<GameStateView> {
  return call(
    'get_game_state',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    gameStateSchema,
  );
}

export async function getGameResult(roomCode: string): Promise<GameSummary> {
  return call('get_game_result', { p_room_code: room(roomCode) }, summarySchema);
}

export async function exportCustomDictionary(roomCode: string) {
  return call(
    'export_custom_dictionary',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    dictionaryExportSchema,
  );
}

export async function playAgain(roomCode: string) {
  return call(
    'play_again',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    playAgainSchema,
  );
}

export async function deleteGameRecord(roomCode: string) {
  return call(
    'delete_game_record',
    { p_room_code: room(roomCode), p_session_token: getSessionToken() },
    okSchema,
  );
}
