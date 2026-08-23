import { expect, type Page } from '@playwright/test';

/** Libellé exact du bouton d'accueil (apostrophe typographique) : évite de capter un toast. */
export const DEMO_BUTTON = 'Essayer avec des données d’exemple';

/** Depuis l'accueil, charge les données d'exemple et attend le portefeuille. */
export async function openDemo(page: Page): Promise<void> {
  await page.goto('#/welcome');
  await page.getByRole('button', { name: DEMO_BUTTON, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Données d.exemple \(fictives\)/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
}
