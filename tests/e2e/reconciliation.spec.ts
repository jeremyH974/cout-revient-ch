/**
 * Réconciliation (P68) : l'écran comparé au moteur, jamais à un chiffre codé en dur. Trois
 * scénarios entièrement déterministes (aucun n'est deviné depuis le contenu de la fixture démo) :
 *
 * - une démo propre ne montre ni ligne à qualifier, ni écart de solde Coinhouse, ni doublon (la
 *   fixture est garantie 0 unqualified / 0 écart de solde par `npm run check`, et un seul import
 *   CSV sur un seul compte ne peut par construction produire aucun doublon) ;
 * - un compte déclaré sans pays fait apparaître « Pays du compte à préciser », dont l'action
 *   renvoie vers Comptes ; renseigner le pays y fait disparaître l'item ;
 * - l'adresse Bitcoin de test (`ONCHAIN_BTC_ADDRESS`, un dépôt puis un retrait NET sur le même
 *   compte on-chain, qui ne peuvent donc pas s'apparier entre eux) fait apparaître un retrait et un
 *   dépôt sans contrepartie, avec preuve (« Pourquoi ce chiffre ? ») et action vers Comptes ;
 * - deux achats manuels identiques (même jour, même actif, même quantité) sur deux comptes
 *   différents produisent un doublon candidat ; l'écarter le retire de la liste SANS toucher aux
 *   positions (aucune suppression automatique, arbitrage explicite de `docs/reconciliation.md`).
 */
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { ONCHAIN_BTC_ADDRESS, stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Remplit le formulaire "Ajouter une opération" (achat) et l'envoie ; compte laissé au défaut. */
async function addManualBuy(
  page: import('@playwright/test').Page,
  opts: { at: string; asset: string; qty: string; amountEur: string; account?: string },
): Promise<void> {
  await page.goto('#/invest/add');
  await page.locator('input[type="datetime-local"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, opts.at);
  await page.getByLabel('Actif').fill(opts.asset);
  await page.getByLabel('Quantité').fill(opts.qty);
  await page.getByLabel(/Total payé en €/).fill(opts.amountEur);
  if (opts.account) await page.getByLabel('Compte').selectOption({ label: opts.account });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
}

test('démo propre : ni ligne à qualifier, ni écart Coinhouse, ni doublon ; le lien de la vue d’ensemble mène ici', async ({
  page,
}) => {
  await openDemo(page);

  // Le badge « À vérifier » de la vue d'ensemble pointe désormais vers la réconciliation (au moins
  // la sauvegarde n'a pas encore été téléchargée sur une démo fraîche : la carte est visible).
  await page.goto('#/');
  const reconLink = page.getByRole('link', { name: 'Voir la réconciliation complète' });
  await expect(reconLink).toBeVisible();
  await expect(reconLink).toHaveAttribute('href', '#/reconciliation');

  await page.goto('#/reconciliation');
  await expect(page.getByRole('heading', { level: 1, name: 'Réconciliation' })).toBeVisible();
  await expect(page.getByText('Lignes à qualifier')).toHaveCount(0);
  await expect(page.getByText('Écart de solde Coinhouse')).toHaveCount(0);
  await expect(page.getByText('Export Coinhouse incomplet')).toHaveCount(0);
  await expect(page.getByText('Doublon possible')).toHaveCount(0);
  await expect(page.getByText('Actif sans cours')).toHaveCount(0);
});

test('compte sans pays : action vers Comptes, disparaît une fois le pays renseigné', async ({
  page,
}) => {
  // Une saisie manuelle suffit à sortir de l'état « aucune donnée » — pas besoin de la démo ici.
  await addManualBuy(page, {
    at: '2026-02-01T09:00:00',
    asset: 'btc',
    qty: '0.1',
    amountEur: '5000',
  });

  await page.goto('#/accounts');
  await page.getByLabel('Nom du compte', { exact: true }).fill('Kraken');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Comptes' })).toContainText('Kraken');

  await page.goto('#/reconciliation');
  const card = page.locator('li', { hasText: 'Pays du compte à préciser' });
  await expect(card).toContainText('Kraken');
  await card.getByRole('button', { name: 'Renseigner le pays' }).click();
  await expect(page).toHaveURL(/#\/accounts$/);

  await page.getByLabel("Pays de l'organisme — Kraken").selectOption({ label: 'France' });
  await page.goto('#/reconciliation');
  await expect(page.getByText('Pays du compte à préciser')).toHaveCount(0);
});

test('virement on-chain non apparié : preuve, « Pourquoi ce chiffre ? » et action vers Comptes', async ({
  page,
}) => {
  await page.goto('#/accounts');
  await page.getByLabel('Adresse ou clé publique étendue').fill(ONCHAIN_BTC_ADDRESS);
  await page.getByRole('button', { name: 'Suivre et synchroniser' }).click();
  await expect(page.getByText(/Synchronisé/)).toBeVisible();

  await page.goto('#/reconciliation');
  // Le dépôt (50 000 sats) et le retrait NET (20 000 sats) du même compte on-chain ne peuvent pas
  // s'apparier entre eux (`pairTransfers` exige deux comptes différents) : les deux restent orphelins.
  await expect(page.getByText('Retrait sans contrepartie')).toBeVisible();
  await expect(page.getByText('Dépôt sans contrepartie')).toBeVisible();

  const why = page.getByRole('button', { name: 'Pourquoi ce chiffre ?' }).first();
  await why.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page
    .locator('li', { hasText: 'Retrait sans contrepartie' })
    .getByRole('button', { name: 'Apparier ou valoriser' })
    .click();
  await expect(page).toHaveURL(/#\/accounts$/);
});

test('doublon candidat : écarter le retire de la liste sans toucher aux positions', async ({
  page,
}) => {
  await page.goto('#/accounts');
  await page.getByLabel('Nom du compte', { exact: true }).fill('Ledger');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Comptes' })).toContainText('Ledger');

  // Même jour, même actif, même quantité, DEUX comptes différents (défaut, puis Ledger) : un achat
  // programmé légitime serait sur le MÊME compte — ce n'est pas le cas ici, d'où le doublon candidat.
  const at = '2026-03-10T10:00:00';
  await addManualBuy(page, { at, asset: 'trx', qty: '100', amountEur: '50' });
  await addManualBuy(page, { at, asset: 'trx', qty: '100', amountEur: '52', account: 'Ledger' });

  await page.goto('#/reconciliation');
  const card = page.locator('li', { hasText: 'Doublon possible' });
  await expect(card).toContainText('TRX');
  await card.getByRole('button', { name: 'Pas un doublon' }).click();
  await expect(page.getByText('Doublon possible')).toHaveCount(0);

  // Les deux positions existent toujours : « écarter » ne supprime jamais de donnée.
  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toContainText('TRX');
});
