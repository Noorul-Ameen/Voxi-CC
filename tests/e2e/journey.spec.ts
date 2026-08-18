import { expect, test, type Page } from '@playwright/test';

async function sendChat(page: Page, message: string) {
  await page.getByTestId('chat-input').fill(message);
  await page.getByTestId('send-button').click();
}

async function waitForAssistant(page: Page, nth: number) {
  await expect(page.getByTestId('message-assistant').nth(nth)).toBeVisible({ timeout: 30_000 });
}

test.describe('homepage', () => {
  test('loads with movie cards from genuine VOX data', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/VOX Conversational Commerce/);
    // Loading state first (skeleton or grid — must never show empty-state while loading).
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    const count = await page.getByTestId('movie-card').count();
    expect(count).toBeGreaterThan(20);
    // Journey bar starts at discovery.
    await expect(page.getByTestId('journey-bar')).toContainText('discovery');
  });

  test('cinema selector is populated from the VOX directory', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    const options = page.getByTestId('cinema-select').locator('option');
    expect(await options.count()).toBeGreaterThan(20);
    await expect(options.filter({ hasText: 'Mall of the Emirates' })).toHaveCount(1);
  });
});

test.describe('conversational journey', () => {
  test('search → cinema → date → showtime, fully synchronized', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });

    await sendChat(page, 'I want to watch spiderman');
    await waitForAssistant(page, 0);
    await expect(page.getByTestId('journey-movie')).toContainText('Spider-Man', { timeout: 15_000 });
    await expect(page.getByTestId('showtime-chip').first()).toBeVisible();

    await sendChat(page, 'Show it at Mall of the Emirates tomorrow');
    await waitForAssistant(page, 1);
    await expect(page.getByTestId('journey-cinema')).toContainText('Mall of the Emirates');
    await expect(page.getByTestId('journey-date')).toContainText('Tomorrow');
    // All visible sessions are MOE.
    const groups = page.getByTestId('cinema-group');
    await expect(groups).toHaveCount(1);
    await expect(groups.first()).toContainText('Mall of the Emirates');

    // Pick a showtime via the UI chips — state must sync back to chat/journey.
    await page.getByTestId('showtime-chip').first().click();
    await expect(page.getByTestId('selected-showtime')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('journey-showtime')).not.toContainText('—');
    // Booking handoff links to the genuine VOX session.
    const href = await page.getByTestId('selected-showtime').locator('a.cta').getAttribute('href');
    expect(href).toMatch(/^https:\/\/uae\.voxcinemas\.com\/booking\/\d+-\d+$/);
  });

  test('changing an earlier selection preserves valid context', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await sendChat(page, 'spider-man at mall of the emirates tomorrow');
    await waitForAssistant(page, 0);
    await expect(page.getByTestId('journey-cinema')).toContainText('Mall of the Emirates');

    await sendChat(page, 'Actually show me City Centre Deira instead');
    await waitForAssistant(page, 1);
    await expect(page.getByTestId('journey-cinema')).toContainText('Deira');
    await expect(page.getByTestId('journey-movie')).toContainText('Spider-Man'); // preserved
  });

  test('movie card click focuses the movie and shows its showtimes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-movie-id="spider-man-brand-new-day"]').click();
    await expect(page.getByTestId('journey-movie')).toContainText('Spider-Man', { timeout: 20_000 });
    await expect(page.getByTestId('showtime-chip').first()).toBeVisible();
  });

  test('suggested actions drive the conversation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('suggested-actions').getByRole('button').first().click();
    await expect(page.getByTestId('message-user').first()).toBeVisible();
    await waitForAssistant(page, 0);
  });
});

test.describe('filters', () => {
  test('family-safe filter shows only family-rated movies', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    const before = await page.getByTestId('movie-card').count();
    await page.getByTestId('family-safe-toggle').click();
    await waitForAssistant(page, 0);
    await expect
      .poll(async () => page.getByTestId('movie-card').count(), { timeout: 20_000 })
      .toBeLessThan(before);
    // Ratings badges visible are only family-safe ones.
    const badges = await page.locator('.rating-badge').allTextContents();
    for (const b of badges) expect(['G', 'PG', 'PG13']).toContain(b);
  });

  test('language filter via chat', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await sendChat(page, 'Any Malayalam movies?');
    await waitForAssistant(page, 0);
    await expect
      .poll(async () => page.getByTestId('movie-card').count(), { timeout: 20_000 })
      .toBeLessThanOrEqual(5);
    await expect(page.getByTestId('movie-grid')).toContainText('Malayalam');
  });

  test('genuine empty result shows the empty state (never during loading)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await sendChat(page, 'Show me Kannada movies');
    await waitForAssistant(page, 0);
    await expect(page.getByTestId('empty-state')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('empty-state')).toContainText(/genuine/i);
  });
});

test.describe('voice degradation', () => {
  test('voice failure leaves text chat fully functional', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('voice-toggle').click();
    // ElevenLabs is not configured in this environment → graceful error.
    await expect(page.getByTestId('voice-status')).toContainText(/chat/i, { timeout: 20_000 });
    // Text keeps working.
    await sendChat(page, 'khalifa');
    await waitForAssistant(page, 0);
    await expect(page.getByTestId('journey-movie')).toContainText('Khalifa', { timeout: 20_000 });
  });
});

test.describe('error handling', () => {
  test('API failure surfaces retryable error without fake data', async ({ page }) => {
    await page.route('**/api/conversation', (route) => route.abort('connectionrefused'));
    await page.goto('/');
    await expect(page.getByTestId('movie-card').first()).toBeVisible({ timeout: 30_000 });
    await sendChat(page, 'spiderman');
    await expect(page.getByTestId('message-assistant').first()).toContainText(/couldn't reach|try again/i, {
      timeout: 20_000,
    });
    // No fabricated selection appeared.
    await expect(page.getByTestId('journey-movie')).toContainText('—');
  });
});
