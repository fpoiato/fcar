import { expect, test } from '@playwright/test';

test.describe('navegação', () => {
  test('vitrine abre em pt-BR', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('fcar — Estoque');
    await expect(page.getByRole('heading', { name: 'Estoque' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    // Moeda formatada no padrão brasileiro
    await expect(page.getByTestId('locale-sample')).toContainText('49.900,00');
  });

  test('menu leva à área do cliente', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Minha conta' }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByRole('heading', { name: 'Minha conta' })).toBeVisible();
  });

  test('rota inexistente mostra página de não encontrado', async ({ page }) => {
    await page.goto('/nao-existe/123');
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar ao estoque' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
