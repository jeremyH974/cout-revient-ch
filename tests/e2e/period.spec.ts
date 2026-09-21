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

test('la plage libre : deux champs, pas un glissement, et elle gouverne l’écran', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('#/');

  // La pastille « Dates » n'est pas une durée : c'est une porte. Elle ouvre deux champs, et
  // s'amorce sur le dernier mois pour qu'on ait quelque chose à ajuster plutôt qu'un vide.
  await chip(page, 'Dates').click();
  const from = page.getByLabel('Du', { exact: true });
  const to = page.getByLabel('au', { exact: true });
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();
  await expect(from).toHaveAttribute('type', 'date');

  // Saisie au clavier, jamais un glisser (WCAG 2.2, critère 2.5.7).
  await from.fill('2026-03-03');
  await to.fill('2026-04-12');

  // L'écran annonce la plage retenue en toutes lettres : « sur 1 mois » serait faux ici.
  await expect(page.getByText('du 03/03/2026 au 12/04/2026').first()).toBeVisible();
});

test('la plage libre traverse les écrans et survit au rechargement', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/');
  await chip(page, 'Dates').click();
  await page.getByLabel('Du', { exact: true }).fill('2026-05-01');
  await page.getByLabel('au', { exact: true }).fill('2026-06-01');

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
  await expect(chip(page, 'Dates')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Du', { exact: true })).toHaveValue('2026-05-01');

  await page.goto('#/trading');
  await expect(chip(page, 'Dates')).toHaveAttribute('aria-checked', 'true');
});

/**
 * Le Rapport suit la même plage (P118, décision n° 179). Ce qui est vérifié n'est pas qu'un
 * sélecteur s'affiche, mais que le DOCUMENT dit sur quelle période il porte, et que ce qui change
 * de sens change de nom : un « Réalisé » d'un mois libellé « Réalisé » se lirait comme le total.
 */
test('le rapport suit la plage, et renomme ce qui change de sens', async ({ page }) => {
  await openDemo(page);
  // Le rapport attend l'historique quotidien pour fenêtrer : on le laisse se charger.
  await page.goto('#/invest');
  await expect(page.locator('section.evolution footer')).toContainText('Sources :', {
    timeout: 30_000,
  });
  await page.goto('#/invest/report');
  const article = page.getByRole('article');
  const summary = article.locator('section.card').filter({ hasText: 'Synthèse' }).first();

  await chip(page, 'Tout').click();
  await expect(article).toContainText('depuis l’origine');
  await expect(summary).toContainText('Réalisé');
  await expect(summary).not.toContainText('Réalisé sur la période');

  await chip(page, '3M').click();
  // Une période partielle se désigne par ses dates, sur la page de garde (Q&R GIPS n° 5014).
  await expect(article).toContainText(
    /Période d.analyse\s*du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}/,
  );
  await expect(summary).toContainText('Réalisé sur la période');
  await expect(summary).toContainText('Résultat sur la période');
  // Moins d'un an : aucun rendement ne s'écrit « par an » (GIPS 2020, 2.A.12 et 5.A.1.b).
  await expect(summary).not.toContainText('par an');
});
