/**
 * Les comptes implicites (décision n° 94).
 *
 * Trois comptes existent parce que des données existent, et c'est cette règle qui décide de ce que
 * l'utilisateur voit dans chaque sélecteur. Elle vivait dans `app.svelte.ts`, couvert à 1,17 %.
 */
import { describe, expect, it } from 'vitest';
import type { ManualTrade } from '../domain/trading/journal';
import {
  COINHOUSE_ACCOUNT_ID,
  MANUAL_ACCOUNT_ID,
  MANUAL_TRADING_ACCOUNT_ID,
  type Account,
  type ManualEvent,
} from '../domain/types';
import { accountLabels, allAccounts, investAccounts } from './accounts';

const manual = (over: Partial<ManualEvent> = {}): ManualEvent => ({
  id: 'm1',
  at: '2026-01-01T10:00:00',
  kind: 'buy',
  asset: 'btc',
  qty: '1',
  amountEur: '100',
  scope: 'external',
  note: '',
  ...over,
});

const trade = (accountId: string): ManualTrade => ({
  id: 't1',
  accountId,
  symbol: 'ETH',
  direction: 'long',
  qty: '1',
  entryPrice: '100',
  exitPrice: null,
  openedAt: '2026-01-01T10:00:00',
  closedAt: null,
  fees: '0',
  quote: 'EUR',
});

const declared = (id: string, createdAt: string, over: Partial<Account> = {}): Account => ({
  id,
  kind: 'csv',
  label: id,
  space: 'invest',
  createdAt,
  ...over,
});

const ids = (accounts: readonly Account[]): string[] => accounts.map((a) => a.id);
const empty = { rawRowKeys: [], manualEvents: [], manualTrades: [], declared: [] };

describe('comptes implicites', () => {
  it('sans aucune donnée, aucun compte', () => {
    expect(allAccounts(empty)).toEqual([]);
  });

  it('une ligne Coinhouse fait exister le compte Coinhouse', () => {
    expect(ids(allAccounts({ ...empty, rawRowKeys: ['r1'] }))).toEqual([COINHOUSE_ACCOUNT_ID]);
  });

  it('une saisie HORS Coinhouse fait exister le compte manuel — une saisie Coinhouse, non', () => {
    expect(ids(allAccounts({ ...empty, manualEvents: [manual({ scope: 'external' })] }))).toEqual([
      MANUAL_ACCOUNT_ID,
    ]);
    // `scope: 'coinhouse'` rattache la saisie au compte Coinhouse : elle ne crée aucun compte.
    expect(allAccounts({ ...empty, manualEvents: [manual({ scope: 'coinhouse' })] })).toEqual([]);
  });

  it('un trade saisi à la main fait exister le compte de trading manuel', () => {
    expect(
      ids(allAccounts({ ...empty, manualTrades: [trade(MANUAL_TRADING_ACCOUNT_ID)] })),
    ).toEqual([MANUAL_TRADING_ACCOUNT_ID]);
    // Un trade rattaché à un compte déclaré n'en crée pas un implicite.
    expect(allAccounts({ ...empty, manualTrades: [trade('hl:abc')] })).toEqual([]);
  });

  it('les implicites viennent d’abord, les déclarés ensuite par ancienneté', () => {
    const accounts = allAccounts({
      rawRowKeys: ['r1'],
      manualEvents: [manual()],
      manualTrades: [],
      declared: [declared('csv:b', '2026-03-01'), declared('csv:a', '2026-01-01')],
    });
    expect(ids(accounts)).toEqual([COINHOUSE_ACCOUNT_ID, MANUAL_ACCOUNT_ID, 'csv:a', 'csv:b']);
  });

  it('un compte implicite n’a pas de date de création : il n’a jamais été créé', () => {
    for (const account of allAccounts({ ...empty, rawRowKeys: ['r1'] }))
      expect(account.createdAt).toBe('');
  });
});

describe('comptes de l’espace Investissement', () => {
  it('retient l’espace invest', () => {
    const accounts = [
      declared('csv:a', '', { space: 'invest' }),
      declared('hl:b', '', { space: 'trading' }),
    ];
    expect(ids(investAccounts(accounts))).toEqual(['csv:a']);
  });

  /**
   * Le test qui justifie la fonction : `spotAsInvestment` fait entrer le spot d'un compte de
   * trading dans l'Investissement SANS déplacer le compte. Filtrer sur le seul `space` en
   * oublierait la moitié — et les avoirs spot disparaîtraient du portefeuille.
   */
  it('retient aussi un compte de TRADING routé par `spotAsInvestment`', () => {
    const routed = declared('hl:b', '', { space: 'trading', spotAsInvestment: true });
    expect(ids(investAccounts([routed]))).toEqual(['hl:b']);
  });

  it('donne un libellé par identifiant', () => {
    expect(accountLabels([declared('csv:a', '', { label: 'Kraken' })])).toEqual({
      'csv:a': 'Kraken',
    });
  });
});
