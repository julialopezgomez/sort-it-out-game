import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import {
  advanceFromReveal,
  cardIds,
  closeRoom,
  completeOneCycle,
  createRoom,
  currentRoles,
  joinRoom,
  makeTwoPlayerRoom,
  newPlayer,
  seedDictionary,
  startGame,
  submitCurrentTurn,
  type PlayerClient,
  type TwoPlayerRoom,
} from './helpers';

const backendConfigured = Boolean(
  process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY,
);

const sixCards = Array.from({ length: 6 }, (_, index) => ({
  en: `Test custom term ${index + 1}`,
  es: `Término de prueba ${index + 1}`,
}));

test.describe('credentialed multiplayer', () => {
  test.skip(
    !backendConfigured,
    'Set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY; see docs/TESTING.md.',
  );

  test('1. a Host creates a room and another player joins', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await expect(room.host.page.getByText(room.guest.name)).toBeVisible();
      await expect(room.guest.page.getByText(room.host.name)).toBeVisible();
      await expect(room.host.page).toHaveURL(new RegExp(`#/room/${room.code}$`));
    } finally {
      await closeRoom(room);
    }
  });

  test('2. a two-player game completes one full cycle', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser, { cycles: 1 });
    try {
      await startGame(room);
      await completeOneCycle(room);
    } finally {
      await closeRoom(room);
    }
  });

  test('3. three players keep independent interface languages', async ({ browser }) => {
    const { room, third } = await makeThreePlayerRoom(browser);
    try {
      await room.guest.page.getByRole('button', { name: 'Español' }).click();
      await expect(
        room.guest.page.getByRole('heading', { name: 'Esperando para empezar' }),
      ).toBeVisible();
      await expect(room.host.page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
      await expect(third.page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
    } finally {
      await closePlayers([room.host, room.guest, third]);
    }
  });

  test('4. English and Spanish clients receive the same canonical card IDs', async ({
    browser,
  }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await room.guest.page.getByRole('button', { name: 'Español' }).click();
      await startGame(room);
      const { ranker, guesser } = await currentRoles(room);
      await ranker.page
        .getByRole('button', { name: /Accept these five|Aceptar estas cinco/ })
        .click();
      await ranker.page.getByRole('button', { name: /Submit my order|Enviar mi orden/ }).click();
      await expect(guesser.page.locator('[data-card-id]')).toHaveCount(5);
      expect(await cardIds(ranker.page)).toEqual(await cardIds(guesser.page));
    } finally {
      await closeRoom(room);
    }
  });

  test('5. the Ranker redraws one card without changing the other four', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await startGame(room);
      const { ranker } = await currentRoles(room);
      const before = await cardIds(ranker.page);
      await ranker.page.getByRole('button', { name: 'Swap card 1 for a random one' }).click();
      await expect.poll(async () => (await cardIds(ranker.page))[0]).not.toBe(before[0]);
      const after = await cardIds(ranker.page);
      expect(after.slice(1)).toEqual(before.slice(1));
      expect(new Set(after).size).toBe(5);
    } finally {
      await closeRoom(room);
    }
  });

  test('6. the Ranker chooses an existing custom card', async ({ browser }) => {
    const room = await roomWithDictionary(browser, sixCards);
    try {
      await startGame(room);
      const { ranker } = await currentRoles(room);
      await ranker.page
        .getByRole('button', { name: 'Pick one of your own terms for card 1' })
        .click();
      await ranker.page.getByRole('button', { name: 'Use this one' }).first().click();
      await expect.poll(async () => (await cardIds(ranker.page))[0]?.startsWith('c:')).toBe(true);
    } finally {
      await closeRoom(room);
    }
  });

  test('7. the Ranker enters a one-language manual card', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await startGame(room);
      const { ranker } = await currentRoles(room);
      await ranker.page.getByRole('button', { name: 'Type in a term for card 1' }).click();
      await ranker.page.getByLabel('English', { exact: true }).fill('A lighthouse at midnight');
      await ranker.page.getByRole('button', { name: 'Add and use it' }).click();
      await expect(ranker.page.getByText('A lighthouse at midnight')).toBeVisible();
      expect((await cardIds(ranker.page))[0]?.startsWith('c:')).toBe(true);
    } finally {
      await closeRoom(room);
    }
  });

  test('8. redrawing all cards leaves five distinct cards', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await startGame(room);
      const { ranker } = await currentRoles(room);
      const before = await cardIds(ranker.page);
      await ranker.page.getByRole('button', { name: 'New five', exact: true }).click();
      await expect
        .poll(async () => (await cardIds(ranker.page)).join(','))
        .not.toBe(before.join(','));
      const after = await cardIds(ranker.page);
      expect(after).toHaveLength(5);
      expect(new Set(after).size).toBe(5);
    } finally {
      await closeRoom(room);
    }
  });

  test('9. custom-only redraw is disabled with five custom cards', async ({ browser }) => {
    const room = await roomWithDictionary(browser, sixCards.slice(0, 5));
    try {
      await startGame(room);
      const { ranker } = await currentRoles(room);
      await expect(
        ranker.page.getByRole('button', { name: 'New five from my own terms only' }),
      ).toBeDisabled();
      await expect(ranker.page.getByText(/You need more than five/)).toBeVisible();
    } finally {
      await closeRoom(room);
    }
  });

  test('10. a Guesser cannot see cards or the secret order before the correct phase', async ({
    browser,
  }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await startGame(room);
      const { ranker, guesser } = await currentRoles(room);
      await expect(guesser.page.locator('[data-card-id]')).toHaveCount(0);
      await ranker.page.getByRole('button', { name: 'Accept these five' }).click();
      await expect(
        ranker.page.getByRole('heading', { name: 'Put them in your order' }),
      ).toBeVisible();
      await expect(guesser.page.locator('[data-card-id]')).toHaveCount(0);
      await ranker.page.getByRole('button', { name: 'Submit my order' }).click();
      await expect(guesser.page.locator('[data-card-id]')).toHaveCount(5);
      await expect(guesser.page.getByRole('heading', { name: 'The answer' })).toHaveCount(0);
    } finally {
      await closeRoom(room);
    }
  });

  test('11. a non-submitter receives zero when the Guesser deadline expires', async ({
    browser,
  }) => {
    test.slow();
    const room = await makeTwoPlayerRoom(browser, { guesserSeconds: 15 });
    try {
      await startGame(room);
      const { ranker, guesser } = await currentRoles(room);
      await ranker.page.getByRole('button', { name: 'Accept these five' }).click();
      await ranker.page.getByRole('button', { name: 'Submit my order' }).click();
      await expect(guesser.page.getByRole('heading', { name: /Guess / })).toBeVisible();
      await expect(guesser.page.getByRole('heading', { name: 'The answer' })).toBeVisible({
        timeout: 25_000,
      });
      await expect(guesser.page.getByText('You did not submit')).toBeVisible();
      await expect(guesser.page.getByText('0', { exact: true }).last()).toBeVisible();
    } finally {
      await closeRoom(room);
    }
  });

  test('12. Ranker expiry submits the most recently persisted order', async ({ browser }) => {
    test.slow();
    const room = await makeTwoPlayerRoom(browser, { rankerSeconds: 15 });
    try {
      await startGame(room);
      const { ranker, guesser } = await currentRoles(room);
      await ranker.page.getByRole('button', { name: 'Accept these five' }).click();
      const original = await cardIds(ranker.page);
      await ranker.page
        .getByRole('button', { name: /Move .* down to position 2/ })
        .first()
        .click();
      const persisted = [original[1], original[0], ...original.slice(2)];
      await ranker.page.waitForTimeout(1_000);
      await expect(guesser.page.getByRole('heading', { name: /Guess / })).toBeVisible({
        timeout: 25_000,
      });
      await guesser.page.getByRole('button', { name: 'Submit my order' }).click();
      await expect(ranker.page.getByRole('heading', { name: 'The answer' })).toBeVisible();
      expect(await cardIds(ranker.page, 'section [data-card-id]')).toEqual(persisted);
    } finally {
      await closeRoom(room);
    }
  });

  test('13. Ranker disconnection pauses the game', async ({ browser }) => {
    test.slow();
    const room = await makeTwoPlayerRoom(browser);
    let remainingContext: BrowserContext | null = null;
    try {
      await startGame(room);
      const { ranker, guesser } = await currentRoles(room);
      remainingContext = guesser.context;
      await ranker.context.close();
      await expect(guesser.page.getByRole('heading', { name: /Waiting for / })).toBeVisible({
        timeout: 45_000,
      });
      await expect(guesser.page.getByText(/lost their connection/)).toBeVisible();
    } finally {
      if (remainingContext) await remainingContext.close().catch(() => undefined);
    }
  });

  test('14. refresh reconnects with the invisible session credential', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await room.guest.page.reload();
      await expect(
        room.guest.page.getByRole('heading', { name: 'Waiting to start' }),
      ).toBeVisible();
      await expect(room.guest.page.getByText(room.guest.name)).toBeVisible();
      await expect(room.guest.page.getByText(room.host.name)).toBeVisible();
    } finally {
      await closeRoom(room);
    }
  });

  test('15. the Host can skip a disconnected non-Host Ranker', async ({ browser }) => {
    test.slow();
    const room = await makeRoomWithGuestRanker(browser);
    try {
      await room.guest.context.close();
      const skip = room.host.page.getByRole('button', {
        name: new RegExp(`Skip ${room.guest.name}`),
      });
      await expect(skip).toBeVisible({ timeout: 45_000 });
      await skip.click();
      await room.host.page
        .getByRole('dialog')
        .getByRole('button', { name: /Skip .* turn/ })
        .click();
      await expect(room.host.page.getByText(/Turn 2/)).toBeVisible();
    } finally {
      await room.host.context.close().catch(() => undefined);
    }
  });

  test('16. voluntary Ranker skip creates a visible zero-score penalty', async ({ browser }) => {
    const room = await makeTwoPlayerRoom(browser);
    try {
      await startGame(room);
      const first = await currentRoles(room);
      await first.ranker.page.getByRole('button', { name: 'Skip my turn as Ranker' }).click();
      await first.ranker.page.getByRole('button', { name: 'Yes, skip my turn' }).click();
      const second = await currentRoles(room);
      await second.ranker.page.getByRole('button', { name: 'Accept these five' }).click();
      await second.ranker.page.getByRole('button', { name: 'Submit my order' }).click();
      await expect(first.ranker.page.getByText(/this turn will score 0/)).toBeVisible();
    } finally {
      await closeRoom(room);
    }
  });

  test('17. a late player sits out the current turn and joins the next one', async ({
    browser,
  }) => {
    const room = await makeTwoPlayerRoom(browser);
    const late = await newPlayer(browser, `Late ${Math.random().toString(36).slice(2, 7)}`);
    try {
      await startGame(room);
      await joinRoom(late, room.code);
      await expect(
        late.page.getByRole('heading', { name: 'You are in — you start on the next turn' }),
      ).toBeVisible();
      await submitCurrentTurn(room);
      await advanceFromReveal(room);
      await expect(late.page.getByText(/Turn 2/)).toBeVisible();
      await expect(late.page.getByText('Joins next turn')).toHaveCount(0);
    } finally {
      await closePlayers([room.host, room.guest, late]);
    }
  });

  test('18. near-simultaneous final submissions reveal exactly once', async ({ browser }) => {
    const { room, third } = await makeThreePlayerRoom(browser);
    try {
      await startGame(room);
      const clients = [room.host, room.guest, third];
      const ranker = await findRanker(clients);
      const guessers = clients.filter((client) => client !== ranker);
      await ranker.page.getByRole('button', { name: 'Accept these five' }).click();
      await ranker.page.getByRole('button', { name: 'Submit my order' }).click();
      await Promise.all(
        guessers.map(async (guesser) => {
          await expect(guesser.page.getByRole('heading', { name: /Guess / })).toBeVisible();
          await guesser.page.getByRole('button', { name: 'Submit my order' }).click();
        }),
      );
      await Promise.all(
        clients.map((client) =>
          expect(client.page.getByRole('heading', { name: 'The answer' })).toBeVisible(),
        ),
      );
      await expect(room.host.page.getByText('2 of 2 have answered')).toHaveCount(0);
    } finally {
      await closePlayers([room.host, room.guest, third]);
    }
  });

  test('19. the finished game shows both leaderboards and the cooperative verdict', async ({
    browser,
  }) => {
    const room = await makeTwoPlayerRoom(browser, { cycles: 1 });
    try {
      await startGame(room);
      await completeOneCycle(room);
      await expect(room.host.page.getByRole('heading', { name: 'Average score' })).toBeVisible();
      await expect(room.host.page.getByRole('heading', { name: 'Total score' })).toBeVisible();
      await expect(
        room.host.page.getByRole('heading', { name: 'Group versus the game' }),
      ).toBeVisible();
    } finally {
      await closeRoom(room);
    }
  });
});

async function roomWithDictionary(
  browser: Browser,
  cards: { en: string | null; es: string | null }[],
): Promise<TwoPlayerRoom> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const host = await newPlayer(browser, `Host ${suffix}`);
  const guest = await newPlayer(browser, `Guest ${suffix}`);
  await seedDictionary(host.context, cards);
  const code = await createRoom(host, { cycles: 1 });
  await joinRoom(guest, code);
  await expect(host.page.getByText(guest.name)).toBeVisible();
  return { host, guest, code };
}

async function makeThreePlayerRoom(browser: Browser): Promise<{
  room: TwoPlayerRoom;
  third: PlayerClient;
}> {
  const room = await makeTwoPlayerRoom(browser, { cycles: 1 });
  const third = await newPlayer(browser, `Third ${Math.random().toString(36).slice(2, 8)}`);
  await joinRoom(third, room.code);
  await expect(room.host.page.getByText(third.name)).toBeVisible();
  return { room, third };
}

async function findRanker(clients: PlayerClient[]): Promise<PlayerClient> {
  await expect
    .poll(async () => {
      for (const client of clients) {
        if (
          await client.page.getByRole('heading', { name: 'Choose your five things' }).isVisible()
        ) {
          return client.name;
        }
      }
      return '';
    })
    .not.toBe('');

  for (const client of clients) {
    if (await client.page.getByRole('heading', { name: 'Choose your five things' }).isVisible()) {
      return client;
    }
  }
  throw new Error('No Ranker was visible');
}

async function makeRoomWithGuestRanker(browser: Browser): Promise<TwoPlayerRoom> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const room = await makeTwoPlayerRoom(browser, { cycles: 1 });
    await startGame(room);
    const { ranker } = await currentRoles(room);
    if (ranker === room.guest) return room;
    await closeRoom(room);
  }
  throw new Error('Could not create a room with a non-Host first Ranker after eight attempts');
}

async function closePlayers(players: PlayerClient[]): Promise<void> {
  await Promise.allSettled(players.map((player) => player.context.close()));
}
