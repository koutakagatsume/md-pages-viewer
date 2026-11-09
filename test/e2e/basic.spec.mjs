import { test, expect } from '@playwright/test';
import { BLANK, SAMPLE, mount, content, sidebarLink, currentSidebar, breadcrumb, toc, urlState } from './helpers.mjs';

test('renders sidebar, breadcrumb, body and table of contents', async ({ page }) => {
  await page.goto(BLANK);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  await expect(currentSidebar(viewer)).toHaveText('はじめに');
  await expect(breadcrumb(viewer)).toHaveText('はじめに');
  await expect(toc(viewer).locator('a')).toHaveText(['概要', '詳細']);
});

test('switching pages updates the URL and the history', async ({ page }) => {
  await page.goto(`${BLANK}?tab=1`);
  const viewer = await mount(page, { options: { pages: SAMPLE } });
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  await sidebarLink(viewer, 'FAQ').click();
  await expect(content(viewer).locator('h1')).toHaveText('FAQ');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('1');
  expect((await urlState(page)).param).toBe('faq');
  await page.goBack();
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
});

test('demo page loads pages.json and src files', async ({ page }) => {
  await page.goto('/demo/');
  const viewer = page.locator('md-pages-viewer');
  await expect(content(viewer).locator('h1')).toHaveText('はじめに');
  await sidebarLink(viewer, 'オプション').click();
  await expect(content(viewer).locator('h1')).toHaveText('オプション');
  await expect(breadcrumb(viewer)).toContainText('オプション');
  await page.screenshot({ path: 'test-results/demo-desktop.png', fullPage: false });
});
