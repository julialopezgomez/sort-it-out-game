import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export type PlayerClient = {
  context: BrowserContext;
  page: Page;
  name: string;
};

export type TwoPlayerRoom = {
  host: PlayerClient;
  guest: PlayerClient;
  code: string;
};

export async function newPlayer(browser: Browser, name: string): Promise<PlayerClient> {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  return { context, page, name };
}

export async function seedDictionary(
  context: BrowserContext,
  cards: { en: string | null; es: string | null }[],
): Promise<void> {
  await context.addInitScript((initialCards) => {
    const now = new Date().toISOString();
    localStorage.setItem(
      'sortitout.dictionary.v1',
      JSON.stringify({
        version: 1,
        updatedAt: now,
        cards: initialCards.map((card) => ({ ...card, addedAt: now })),
      }),
    );
  }, cards);
}

export async function createRoom(
  player: PlayerClient,
  options: { cycles?: number; rankerSeconds?: number; guesserSeconds?: number } = {},
): Promise<string> {
  await player.page.goto('./#/create');
  await player.page.getByLabel('Your name').fill(player.name);

  const cycles = options.cycles ?? 1;
  await player.page.getByRole('button', { name: String(cycles), exact: true }).click();

  if (options.rankerSeconds !== undefined) {
    await chooseTime(
      player.page,
      'Time for the Ranker to put the cards in order',
      options.rankerSeconds,
    );
  }
  if (options.guesserSeconds !== undefined) {
    await chooseTime(player.page, 'Time for everyone else to guess', options.guesserSeconds);
  }

  await player.page.getByRole('button', { name: 'Create the room' }).click();
  await expect(player.page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();

  const match = /#\/room\/([A-Z2-9]{6})/.exec(player.page.url());
  if (!match?.[1]) throw new Error(`Could not read room code from ${player.page.url()}`);
  return match[1];
}

export async function joinRoom(player: PlayerClient, code: string): Promise<void> {
  await player.page.goto(`./#/join/${code}`);
  await player.page.getByLabel('Your name').fill(player.name);
  await player.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(player.page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
}

export async function makeTwoPlayerRoom(
  browser: Browser,
  options: { cycles?: number; rankerSeconds?: number; guesserSeconds?: number } = {},
): Promise<TwoPlayerRoom> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const host = await newPlayer(browser, `Host ${suffix}`);
  const guest = await newPlayer(browser, `Guest ${suffix}`);
  const code = await createRoom(host, options);
  await joinRoom(guest, code);
  await expect(host.page.getByText(guest.name)).toBeVisible();
  return { host, guest, code };
}

export async function startGame(room: TwoPlayerRoom): Promise<void> {
  await room.host.page.getByRole('button', { name: 'Start the game' }).click();
  await expect
    .poll(
      async () =>
        Number(await room.host.page.getByText(/Turn 1/).count()) +
        Number(await room.guest.page.getByText(/Turn 1/).count()),
    )
    .toBeGreaterThan(0);
}

export async function currentRoles(room: TwoPlayerRoom): Promise<{
  ranker: PlayerClient;
  guesser: PlayerClient;
}> {
  await expect
    .poll(async () => {
      if (
        await room.host.page.getByRole('heading', { name: 'Choose your five things' }).isVisible()
      )
        return 'host';
      if (
        await room.guest.page.getByRole('heading', { name: 'Choose your five things' }).isVisible()
      )
        return 'guest';
      return 'none';
    })
    .not.toBe('none');

  const hostRanks = await room.host.page
    .getByRole('heading', { name: 'Choose your five things' })
    .isVisible();
  return hostRanks
    ? { ranker: room.host, guesser: room.guest }
    : { ranker: room.guest, guesser: room.host };
}

export async function submitCurrentTurn(room: TwoPlayerRoom): Promise<void> {
  const { ranker, guesser } = await currentRoles(room);
  await ranker.page.getByRole('button', { name: 'Accept these five' }).click();
  await expect(ranker.page.getByRole('heading', { name: 'Put them in your order' })).toBeVisible();
  await ranker.page.getByRole('button', { name: 'Submit my order' }).click();
  await expect(
    guesser.page.getByRole('heading', { name: new RegExp(`Guess ${escapeRegex(ranker.name)}`) }),
  ).toBeVisible();
  await guesser.page.getByRole('button', { name: 'Submit my order' }).click();
  await expect(room.host.page.getByRole('heading', { name: 'The answer' })).toBeVisible();
  await expect(room.guest.page.getByRole('heading', { name: 'The answer' })).toBeVisible();
}

export async function advanceFromReveal(room: TwoPlayerRoom): Promise<void> {
  await room.host.page.getByRole('button', { name: 'Next turn now' }).click();
}

export async function completeOneCycle(room: TwoPlayerRoom): Promise<void> {
  await submitCurrentTurn(room);
  await advanceFromReveal(room);
  await expect.poll(async () => room.host.page.getByText(/Turn 2/).count()).toBeGreaterThan(0);
  await submitCurrentTurn(room);
  await advanceFromReveal(room);
  await expect(room.host.page.getByRole('heading', { name: 'Final results' })).toBeVisible();
  await expect(room.guest.page.getByRole('heading', { name: 'Final results' })).toBeVisible();
}

export async function cardIds(page: Page, selector = '[data-card-id]'): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-card-id') ?? ''),
    );
}

export async function closeRoom(room: TwoPlayerRoom): Promise<void> {
  await Promise.allSettled([room.host.context.close(), room.guest.context.close()]);
}

async function chooseTime(page: Page, legend: string, seconds: number): Promise<void> {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const label = `${minutes}:${String(remainder).padStart(2, '0')}`;
  await page
    .getByRole('group', { name: legend })
    .getByRole('button', { name: label, exact: true })
    .click();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
