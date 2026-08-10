import { normalizeCustomCards, customCardKey, type CustomCardInput } from './normalize';

/**
 * The Host's private dictionary.
 *
 * Since there are no accounts, "private dictionary" means exactly this: a versioned copy
 * in the Host's own browser. It is uploaded into each game the Host creates, and cards
 * that anyone invents during play are synchronized back here while the Host is connected.
 *
 * There is deliberately no shared or global custom dictionary: one family's inside jokes
 * are nobody else's business.
 */

const STORAGE_KEY = 'sortitout.dictionary.v1';
const CURRENT_VERSION = 1;

export type StoredCard = {
  en: string | null;
  es: string | null;
  addedAt: string;
};

type StoredDictionary = {
  version: number;
  updatedAt: string;
  cards: StoredCard[];
};

function emptyDictionary(): StoredDictionary {
  return { version: CURRENT_VERSION, updatedAt: new Date().toISOString(), cards: [] };
}

function read(): StoredDictionary {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDictionary();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('cards' in parsed) ||
      !Array.isArray((parsed as StoredDictionary).cards)
    ) {
      return emptyDictionary();
    }
    const dictionary = parsed as StoredDictionary;
    // Future versions are handled here; today there is only one.
    return { ...emptyDictionary(), ...dictionary, version: CURRENT_VERSION };
  } catch {
    return emptyDictionary();
  }
}

function write(dictionary: StoredDictionary): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...dictionary,
        version: CURRENT_VERSION,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* storage full or blocked: the game still works, the dictionary just is not kept */
  }
}

export function loadLocalDictionary(): StoredCard[] {
  return read().cards;
}

/** Cards in the shape the create-room RPC wants. */
export function localDictionaryForUpload(): { en: string | null; es: string | null }[] {
  return read().cards.map((card) => ({ en: card.en, es: card.es }));
}

/**
 * Merge cards into the local dictionary, skipping normalized duplicates. Returns how many
 * were actually new, so the UI can say "3 new cards saved to this browser".
 */
export function mergeIntoLocalDictionary(cards: readonly CustomCardInput[]): number {
  const current = read();
  const existingKeys = current.cards.map((card) => customCardKey(card.en, card.es));
  const { cards: fresh } = normalizeCustomCards(cards, existingKeys);

  if (fresh.length === 0) return 0;

  const now = new Date().toISOString();
  write({
    ...current,
    cards: [...current.cards, ...fresh.map((card) => ({ en: card.en, es: card.es, addedAt: now }))],
  });
  return fresh.length;
}

export function removeFromLocalDictionary(en: string | null, es: string | null): void {
  const current = read();
  const key = customCardKey(en, es);
  write({ ...current, cards: current.cards.filter((c) => customCardKey(c.en, c.es) !== key) });
}

export function clearLocalDictionary(): void {
  write(emptyDictionary());
}

export function localDictionaryCount(): number {
  return read().cards.length;
}
