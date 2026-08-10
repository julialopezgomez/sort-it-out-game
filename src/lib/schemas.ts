import { z } from 'zod';
import {
  CYCLES_MAX,
  CYCLES_MIN,
  NAME_MAX_LENGTH,
  CARD_TEXT_MAX_LENGTH,
  TIME_LIMIT_MAX_SECONDS,
  TIME_LIMIT_MIN_SECONDS,
} from './types';

/**
 * Zod schemas for everything crossing the wire.
 *
 * Outgoing: catches a bad payload before it costs a round trip.
 * Incoming: the RPC response is validated too, so a schema drift after a migration shows
 * up as a clear error instead of a mystery `undefined` deep inside a component.
 *
 * None of this is a security boundary. The database re-validates every field itself; see
 * the RPCs in supabase/migrations/00{50,60,70}_*.sql.
 */

export const languageSchema = z.enum(['en', 'es']);

export const phaseSchema = z.enum([
  'lobby',
  'preparing_cards',
  'ranker_ordering',
  'guessers_ordering',
  'reveal',
  'paused',
  'next_turn',
  'finished',
  'cancelled',
]);

export const timeLimitSchema = z
  .number()
  .int()
  .min(TIME_LIMIT_MIN_SECONDS)
  .max(TIME_LIMIT_MAX_SECONDS)
  .nullable();

export const settingsSchema = z.object({
  totalCycles: z.number().int().min(CYCLES_MIN).max(CYCLES_MAX),
  rankerSeconds: timeLimitSchema,
  guesserSeconds: timeLimitSchema,
  allowManualCards: z.boolean(),
});

export const displayNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\s+/g, ' ').trim())
  .refine((value) => value.length >= 1, { message: 'INVALID_NAME' })
  .refine((value) => value.length <= NAME_MAX_LENGTH, { message: 'INVALID_NAME' });

export const cardTextSchema = z
  .string()
  .max(CARD_TEXT_MAX_LENGTH)
  .nullable()
  .transform((value) => {
    if (value === null) return null;
    const cleaned = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    return cleaned === '' ? null : cleaned;
  });

export const customCardSchema = z
  .object({ en: cardTextSchema, es: cardTextSchema })
  .refine((card) => card.en !== null || card.es !== null, { message: 'CARD_NEEDS_TEXT' });

export const customCardListSchema = z.array(customCardSchema).max(2000);

/** An ordering is always exactly five distinct canonical ids. */
export const orderSchema = z
  .array(z.string().min(1).max(64))
  .length(5)
  .refine((order) => new Set(order).size === order.length, { message: 'INVALID_ORDER' });

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Postgres numerics arrive as numbers or strings depending on magnitude; accept both. */
const numericSchema = z.union([z.number(), z.string().transform((v) => Number(v))]).nullable();

export const cardViewSchema = z.object({
  canonicalId: z.string(),
  source: z.enum(['factory', 'custom']),
  text: z.string().nullable(),
  shownLanguage: languageSchema,
  requestedLanguage: languageSchema,
  slot: z.number().int().optional(),
  position: z.number().int().optional(),
});

export const comparisonRowSchema = cardViewSchema.extend({
  myPosition: z.number().int(),
  rankerPosition: z.number().int().nullable(),
  correct: z.boolean(),
});

export const playerViewSchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  isHost: z.boolean(),
  connected: z.boolean(),
  rotationPosition: z.number().int(),
  joinsNextTurn: z.boolean(),
  totalScore: z.number().int(),
  scoredGuesserTurns: z.number().int(),
  average: numericSchema,
  rankerTurnsCompleted: z.number().int(),
  rankerTurnsSkipped: z.number().int(),
  pendingPenalties: z.number().int(),
  consumedPenalties: z.number().int(),
  isRanker: z.boolean(),
  submitted: z.boolean(),
});

export const turnViewSchema = z.object({
  turnId: z.string(),
  turnNumber: z.number().int(),
  cycleNumber: z.number().int(),
  rankerPlayerId: z.string(),
  rankerDisplayName: z.string(),
  rankerConnected: z.boolean(),
  iAmRanker: z.boolean(),
  iAmEligibleGuesser: z.boolean(),
  cardsAccepted: z.boolean(),
  cards: z.array(cardViewSchema).nullable(),
  myOrder: z.array(z.string()).nullable(),
  iHaveSubmitted: z.boolean(),
  eligibleGuesserCount: z.number().int(),
  submittedCount: z.number().int(),
  skipped: z.boolean(),
  status: z.enum(['active', 'scored', 'skipped']),
});

export const revealViewSchema = z.object({
  turnNumber: z.number().int(),
  rankerPlayerId: z.string(),
  rankerDisplayName: z.string(),
  rankerOrder: z.array(cardViewSchema),
  turnGroupPoints: z.number().int(),
  turnGamePoints: z.number().int(),
  turnPossiblePoints: z.number().int(),
  cumulativeGroupPoints: z.number().int(),
  cumulativeGamePoints: z.number().int(),
  cumulativePossiblePoints: z.number().int(),
  perPlayer: z.array(
    z.object({
      playerId: z.string(),
      displayName: z.string(),
      rawScore: z.number().int().nullable(),
      awardedScore: z.number().int().nullable(),
      penaltyApplied: z.boolean(),
      submitted: z.boolean(),
    }),
  ),
  myComparison: z.array(comparisonRowSchema).nullable(),
  myRawScore: z.number().int().nullable(),
  myAwardedScore: z.number().int().nullable(),
  myPenaltyApplied: z.boolean(),
  mySubmitted: z.boolean(),
});

export const summarySchema = z.object({
  gameId: z.string(),
  roomCode: z.string(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  settings: settingsSchema,
  cyclesCompleted: z.number().int(),
  scoredTurns: z.number().int(),
  cooperative: z.object({
    groupPoints: z.number().int(),
    gamePoints: z.number().int(),
    possiblePoints: z.number().int(),
    groupSuccessPercent: numericSchema,
    verdict: z.enum(['group', 'draw', 'game']),
  }),
  players: z.array(
    z.object({
      playerId: z.string(),
      displayName: z.string(),
      totalScore: z.number().int(),
      scoredGuesserTurns: z.number().int(),
      average: numericSchema,
      rankerTurnsCompleted: z.number().int(),
      rankerTurnsSkipped: z.number().int(),
      pendingPenalties: z.number().int(),
      consumedPenalties: z.number().int(),
      totalPlace: z.number().int(),
      averagePlace: z.number().int(),
    }),
  ),
});

export const gameStateSchema = z.object({
  serverNow: z.string(),
  game: z.object({
    gameId: z.string(),
    roomCode: z.string(),
    phase: phaseSchema,
    effectivePhase: phaseSchema,
    totalCycles: z.number().int(),
    currentCycle: z.number().int(),
    currentTurnNumber: z.number().int(),
    rankerSeconds: z.number().int().nullable(),
    guesserSeconds: z.number().int().nullable(),
    allowManualCards: z.boolean(),
    deadlineAt: z.string().nullable(),
    pausedAt: z.string().nullable(),
    pauseReason: z.enum(['manual', 'ranker_disconnected']).nullable(),
    remainingMs: z.number().int().nullable(),
    groupPoints: z.number().int(),
    gamePoints: z.number().int(),
    possiblePoints: z.number().int(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    customCardCount: z.union([z.number(), z.string().transform(Number)]),
    nextRoomCode: z.string().nullable(),
  }),
  me: z.object({
    playerId: z.string(),
    displayName: z.string(),
    language: languageSchema,
    isHost: z.boolean(),
    totalScore: z.number().int(),
    scoredGuesserTurns: z.number().int(),
    average: numericSchema,
    pendingPenalties: z.number().int(),
    consumedPenalties: z.number().int(),
    rankerTurnsCompleted: z.number().int(),
    rankerTurnsSkipped: z.number().int(),
    eligibleFromTurn: z.number().int(),
  }),
  players: z.array(playerViewSchema),
  turn: turnViewSchema.nullable(),
  reveal: revealViewSchema.nullable(),
  customCards: z
    .array(
      z.object({
        id: z.string(),
        textEn: z.string().nullable(),
        textEs: z.string().nullable(),
        usedThisTurn: z.boolean(),
        usedEver: z.boolean(),
      }),
    )
    .nullable(),
  result: summarySchema.nullable(),
});

export const joinResultSchema = z.object({
  roomCode: z.string(),
  gameId: z.string(),
  playerId: z.string(),
  mode: z.enum(['joined', 'resumed', 'reclaimed']),
});

export const createResultSchema = z.object({
  roomCode: z.string(),
  gameId: z.string(),
  playerId: z.string(),
  import: z.object({
    inserted: z.number().int(),
    duplicates: z.number().int(),
    invalid: z.number().int(),
  }),
});

export const importResultSchema = z.object({
  inserted: z.number().int(),
  duplicates: z.number().int(),
  invalid: z.number().int(),
});

export const dictionaryExportSchema = z.object({
  roomCode: z.string(),
  cards: z.array(z.object({ en: z.string().nullable(), es: z.string().nullable() })),
});

export const heartbeatSchema = z.object({
  serverNow: z.string(),
  phase: phaseSchema,
  turnNumber: z.number().int(),
});

export const advanceSchema = z.object({
  phase: phaseSchema,
  turnNumber: z.number().int(),
  serverNow: z.string(),
});

export type GameStateView = z.infer<typeof gameStateSchema>;
export type PlayerView = z.infer<typeof playerViewSchema>;
export type TurnView = z.infer<typeof turnViewSchema>;
export type RevealView = z.infer<typeof revealViewSchema>;
export type CardView = z.infer<typeof cardViewSchema>;
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;
export type GameSummary = z.infer<typeof summarySchema>;
export type JoinResult = z.infer<typeof joinResultSchema>;
export type CreateResult = z.infer<typeof createResultSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
