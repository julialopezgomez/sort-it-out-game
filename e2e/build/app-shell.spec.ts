import { expect, test } from '@playwright/test';

test('20. the production build works at the GitHub Pages base path', async ({ page, baseURL }) => {
  const response = await page.goto('./');

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle('Sort It Out');
  await expect(page.getByRole('heading', { name: 'Sort It Out', level: 1 })).toBeVisible();
  expect(page.url()).toContain('/sort-it-out-game/');
  expect(baseURL).toContain('/sort-it-out-game/');
});

test('hash routes work without a server rewrite', async ({ page }) => {
  await page.goto('./#/rules');
  await expect(page.getByRole('heading', { name: 'How to play Sort It Out' })).toBeVisible();

  await page.goto('./#/history');
  await expect(page.getByRole('heading', { name: 'Games played on this device' })).toBeVisible();
});

test('language choice is local to the browser and survives navigation', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('heading', { name: 'Cómo se juega' })).toBeVisible();

  await page.getByRole('link', { name: 'Leer las reglas completas' }).first().click();
  await expect(page.getByRole('heading', { name: 'Cómo jugar a Sort It Out' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('colour theme choice is local and survives a reload', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Choose a colour theme' }).click();
  await page.getByRole('button', { name: 'Berry' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'berry');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 247, 250)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'berry');

  await page.getByRole('button', { name: 'Choose a colour theme' }).click();
  await page.getByRole('button', { name: 'Ocean' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
});

test('theme controls fit on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('./');

  await expect(page.getByRole('button', { name: 'Choose a colour theme' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Español' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose a colour theme' }).click();
  const picker = page.getByRole('group', { name: 'Colour theme' });
  await expect(picker).toBeVisible();
  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});

test('the PWA manifest and every declared icon are published', async ({ request }) => {
  const manifestResponse = await request.get('./manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = (await manifestResponse.json()) as {
    start_url: string;
    icons: { src: string }[];
  };

  expect(manifest.start_url).toBe('/sort-it-out-game/');
  expect(manifest.icons).toHaveLength(3);

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok(), icon.src).toBe(true);
    expect(iconResponse.headers()['content-type']).toContain('image/png');
  }
});
