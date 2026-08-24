import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/**
 * Compte déclaré et saisie manuelle rattachée, créés AVANT de charger la démo. Ajouter une saisie
 * manuelle quitte le mode démo (`AppState.exitDemo`), ce qui efface aussi les lignes Coinhouse déjà
 * importées (voir tests/e2e/discreet.spec.ts) : si la démo était chargée en premier, ce même geste
 * effacerait le compte Coinhouse et le compte déclaré avec elle. En les créant d'abord (mode démo
 * inactif, `exitDemo` ne fait alors rien), puis en chargeant la démo par-dessus, le compte Coinhouse
 * et le compte déclaré coexistent — comme le feraient un import réel suivi d'une saisie manuelle.
 */
test('comptes : compte déclaré, saisie rattachée, filtre « Plateforme », suppression refusée', async ({
  page,
}) => {
  await page.goto('#/accounts');
  await expect(page.getByRole('heading', { name: 'Comptes', level: 1 })).toBeVisible();

  // Ajout d'un compte déclaré.
  await page.getByLabel('Nom du compte', { exact: true }).fill('Ledger');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const list = page.getByRole('list', { name: 'Comptes' });
  await expect(list).toContainText('Ledger');

  // Saisie manuelle rattachée à ce compte.
  await page.goto('#/invest/add');
  // `fill` refuse les secondes sur un datetime-local (step=1) : DOM + event input (voir discreet.spec.ts).
  await page.locator('input[type="datetime-local"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, '2026-01-01T10:00:00');
  await page.getByLabel('Actif').fill('trx');
  await page.getByLabel('Quantité').fill('100');
  await page.getByLabel(/Total payé en €/).fill('50');
  await page.getByLabel('Compte').selectOption({ label: 'Ledger' });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.locator('section.list p.line')).toHaveCount(1);

  // Données Coinhouse (démo) par-dessus : le compte Coinhouse implicite rejoint le compte déclaré.
  await openDemo(page);
  await page.goto('#/accounts');
  await expect(list).toContainText('Coinhouse');
  await expect(list).toContainText('Ledger');

  // Filtre « Plateforme » sur les positions : consolidé par défaut, PRU par plateforme sur demande.
  await page.goto('#/invest');
  const platformSelect = page.getByLabel('Plateforme');
  await expect(platformSelect).toBeVisible();
  await platformSelect.selectOption({ label: 'Ledger' });
  await expect(page.locator('p.scope-note')).toContainText('Positions de Ledger seule');
  const rows = page.getByRole('list', { name: 'Positions' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('TRX');
  await platformSelect.selectOption({ label: 'Toutes plateformes' });
  await expect(page.locator('p.scope-note')).toHaveCount(0);

  // Suppression refusée : le compte a une saisie rattachée.
  await page.goto('#/accounts');
  await page.getByRole('button', { name: 'Supprimer le compte Ledger' }).click();
  await expect(
    page.getByText('Ce compte a des saisies : supprimez-les ou rattachez-les avant.'),
  ).toBeVisible();
  await expect(list).toContainText('Ledger');
});
