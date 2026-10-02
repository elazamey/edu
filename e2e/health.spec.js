import { test, expect } from '@playwright/test';

test('Health check endpoint responds correctly', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toEqual({ status: 'ok', service: 'Nexus Agent Platform' });
});

test('Starter page displays service status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nexus Agent Platform' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Service: ok');
});
