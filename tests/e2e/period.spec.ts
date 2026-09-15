import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';

/**
 * **La plage d'analyse est UNE valeur, pour toute l'application** (décision n° 156).
 *
 * Elle vivait dans trois vocabulaires — `1S/1M/3M/1A/Tout`, `1J/1S/1M/Tout`, `7 jours/30 jours/Tout`
 * — chacun dans l'état local de son composant. Deux écrans pouvaient donc afficher deux périodes
 * différentes sans que rien ne le dise, et un rechargement ramenait tout au défaut.
 *
 * Ce fichier éprouve les deux moitiés de la promesse, parce qu'aucune ne se déduit de l'autre :
 * elle **traverse les écrans**, et elle **survit au rechargement**.
 */
const chip = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true });

test('la plage choisie sur la vue d’ensemble se retrouve sur le trading', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/');
  await chip(page, '3M').click();
  await expect(chip(page, '3M')).toHaveAttribute('aria-checked', 'true');

  await page.goto('#/trading');
  // Le bloc « Résultat » se calcule depuis les fills : il PEUT honorer la plage, donc il la suit.
  await expect(chip(page, '3M')).toHaveAttribute('aria-checked', 'true');
  await expect(chip(page, '1M')).toHaveAttribute('aria-checked', 'false');
});

test('elle survit au rechargement, sans repartir au défaut', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/');
  await chip(page, '1A').click();
  await expect(chip(page, '1A')).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
  await expect(chip(page, '1A')).toHaveAttribute('aria-checked', 'true');
});

test('la courbe d’équité garde les fenêtres de la plateforme, et le dit', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/trading');
  // Hyperliquid ne sert que ses propres fenêtres : la courbe ne peut pas suivre une plage libre,
  // et l'écran doit l'annoncer plutôt que d'afficher une période qu'il n'a pas reçue.
  await expect(page.getByText(/fenêtres sont celles d.Hyperliquid/)).toBeVisible();
});
