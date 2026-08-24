import { expect, type Page } from '@playwright/test';

/** Libellé exact du bouton d'accueil (apostrophe typographique) : évite de capter un toast. */
export const DEMO_BUTTON = 'Essayer avec des données d’exemple';

/**
 * Depuis l'accueil, charge les données d'exemple : atterrit sur la Vue d'ensemble (`#/`), puis va
 * au portefeuille (`#/invest`) où vivent la liste « Positions » et la synthèse (bouton « Actualiser »).
 */
export async function openDemo(page: Page): Promise<void> {
  await page.goto('#/welcome');
  await page.getByRole('button', { name: DEMO_BUTTON, exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /Données d.exemple \(fictives\)/ }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
  await waitForPrices(page);
}

/**
 * Attend la fin de l'actualisation des prix lancée à l'ouverture : les cotations arrivent
 * fournisseur par fournisseur (CoinGecko puis la longue traîne, dont Kraken espace ses requêtes),
 * et les specs comparent des écrans entre eux — ils doivent lire un état stabilisé.
 */
export async function waitForPrices(page: Page): Promise<void> {
  const summary = page.locator('section.summary');
  await expect(summary.getByRole('button', { name: 'Actualiser', exact: true })).toBeEnabled();
  await expect(summary.getByText(/^Prix : /)).toBeVisible();
  // Les cotations sont appliquées fournisseur par fournisseur : la synthèse annonce « Prix : … »
  // dès la première réponse, alors que la longue traîne (Hyperliquid pour l'actif que personne
  // d'autre ne cote, puis DefiLlama) peut arriver plusieurs secondes plus tard. Tant qu'une
  // position reste sans cours, les cellules « Valeur », « Latent » et « Total » affichent « — » :
  // les specs qui recoupent des chiffres liraient un écran à moitié calculé.
  await expect(page.getByText('Prix indisponible')).toHaveCount(0, { timeout: 20_000 });
}
