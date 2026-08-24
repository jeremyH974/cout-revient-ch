/**
 * Import Ghostfolio (export JSON d'activités) : résolution du code d'actif (CoinGecko/Yahoo),
 * mapping BUY/SELL/DIVIDEND/INTEREST/FEE/LIABILITY vers des brouillons pivot, gardes runtime sur
 * les activités malformées, et aval complet (comptages, valeur du trade, ré-import idempotent par
 * clé de contenu natif). Jeu de données 100 % synthétique (inventé), aucun export réel.
 */
import { describe, expect, it } from 'vitest';
import { pivotLedgerEvents } from '../pivot/events';
import { ghostfolioAsset, importGhostfolioJson } from './index';

const ACCOUNT_ID = 'gf:test';
const USD_RATE = (): string => '1.1';

/**
 * Export complet synthétique : 7 activités couvrant les 6 types Ghostfolio, deux sources de prix
 * (COINGECKO, YAHOO) et un revenu cash pur (INTEREST sans dataSource).
 */
const FULL_EXPORT = {
  meta: { date: '2026-08-24T00:00:00.000Z', version: '2.100.0' },
  accounts: [{ id: 'acc-1', name: 'Compte Test', currency: 'EUR' }],
  platforms: [],
  tags: [],
  user: { id: 'user-1' },
  activities: [
    {
      accountId: 'acc-1',
      comment: 'Achat BTC',
      fee: 15,
      id: 'act-1',
      quantity: 0.05,
      type: 'BUY',
      unitPrice: 20000,
      currency: 'EUR',
      dataSource: 'COINGECKO',
      date: '2025-01-10T09:00:00.000Z',
      symbol: 'bitcoin',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: null,
      fee: 0,
      id: 'act-2',
      quantity: 0.01,
      type: 'SELL',
      unitPrice: 25000,
      currency: 'EUR',
      dataSource: 'COINGECKO',
      date: '2025-02-15T10:30:00.000Z',
      symbol: 'bitcoin',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: null,
      fee: 0,
      id: 'act-3',
      quantity: 0.002,
      type: 'DIVIDEND',
      unitPrice: 1800,
      currency: 'EUR',
      dataSource: 'COINGECKO',
      date: '2025-03-01T08:00:00.000Z',
      symbol: 'ethereum',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: null,
      fee: 0,
      id: 'act-4',
      quantity: 1,
      type: 'INTEREST',
      unitPrice: 12,
      currency: 'EUR',
      dataSource: null,
      date: '2025-03-05T00:00:00.000Z',
      symbol: 'INTEREST_EUR',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: 'Frais de garde',
      fee: 5,
      id: 'act-5',
      quantity: 0,
      type: 'FEE',
      unitPrice: 0,
      currency: 'EUR',
      dataSource: null,
      date: '2025-03-10T00:00:00.000Z',
      symbol: 'FEE_EUR',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: null,
      fee: 0,
      id: 'act-6',
      quantity: 1,
      type: 'LIABILITY',
      unitPrice: 100,
      currency: 'EUR',
      dataSource: null,
      date: '2025-03-15T00:00:00.000Z',
      symbol: 'LIABILITY_EUR',
      tags: [],
    },
    {
      accountId: 'acc-1',
      comment: null,
      fee: 2,
      id: 'act-7',
      quantity: 0.5,
      type: 'BUY',
      unitPrice: 1800,
      currency: 'EUR',
      dataSource: 'YAHOO',
      date: '2025-04-01T12:00:00.000Z',
      symbol: 'ETH-EUR',
      tags: [],
    },
  ],
};

describe('ghostfolioAsset', () => {
  it('résout CoinGecko et Yahoo, conserve un slug CoinGecko inconnu', () => {
    expect(ghostfolioAsset('bitcoin', 'COINGECKO')).toEqual({ code: 'btc', note: null });
    expect(ghostfolioAsset('ETH-EUR', 'YAHOO')).toEqual({ code: 'eth', note: null });
    expect(ghostfolioAsset('BTC-USD', 'YAHOO')).toEqual({ code: 'btc', note: null });
    expect(ghostfolioAsset('some-unknown-coin', 'COINGECKO')).toEqual({
      code: 'some-unknown-coin',
      note: 'actif CoinGecko non répertorié',
    });
    expect(ghostfolioAsset('FEE_EUR', null)).toEqual({ code: 'fee_eur', note: null });
  });
});

describe('importGhostfolioJson — export complet', () => {
  it('importe les 7 activités : comptages, période et actifs attendus', () => {
    const result = importGhostfolioJson(
      JSON.stringify(FULL_EXPORT),
      {},
      ACCOUNT_ID,
      'i1',
      USD_RATE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.format).toBe('ghostfolio-json');
    expect(result.report.totalRows).toBe(7);
    expect(result.report.parsedRows).toBe(6); // LIABILITY ne produit aucune ligne pivot
    expect(result.report.newRows).toBe(6);
    expect(result.report.counts).toMatchObject({
      trades: 3,
      rewards: 1,
      fees: 1,
      skippedCash: 1,
      skippedInternal: 1,
    });
    expect(result.report.assets).toEqual(['btc', 'eth', 'eur']);
    expect(result.report.period).not.toBeNull();
    expect(result.report.period?.from.startsWith('2025-01-10')).toBe(true);
    expect(result.report.period?.to.startsWith('2025-04-01')).toBe(true);
    // Toutes les clés hachent le contenu natif de l'activité.
    for (const key of Object.keys(result.rows))
      expect(key.startsWith(`pv:${ACCOUNT_ID}:`)).toBe(true);
  });

  it('joint le nom du compte Ghostfolio et le commentaire dans la description', () => {
    const result = importGhostfolioJson(
      JSON.stringify(FULL_EXPORT),
      {},
      ACCOUNT_ID,
      'i1',
      USD_RATE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = Object.values(result.rows).filter((r) => r.accountId === ACCOUNT_ID);
    const buy = rows.find((r) => r.sent?.currency === 'eur' && r.received?.currency === 'btc');
    expect(buy?.description).toBe('Compte Ghostfolio : Compte Test — Achat BTC');
  });
});

describe('importGhostfolioJson — valeur du trade en aval', () => {
  it('un BUY vaut quantity × unitPrice + fee, frais inclus (contre-jambe EUR)', () => {
    const buyOnly = { activities: [FULL_EXPORT.activities[0]] };
    const result = importGhostfolioJson(JSON.stringify(buyOnly), {}, ACCOUNT_ID, 'i1', USD_RATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = Object.values(result.rows).filter((r) => r.accountId === ACCOUNT_ID);
    const { events } = pivotLedgerEvents(rows, {}, USD_RATE);
    const trade = events.find((e) => e.kind === 'trade');
    expect(trade).toBeDefined();
    if (!trade || trade.kind !== 'trade') return;
    expect(trade.out).toEqual({ asset: 'eur', qty: '1000' });
    expect(trade.in).toEqual({ asset: 'btc', qty: '0.05' });
    // 0.05 × 20000 = 1000, + 15 de frais = 1015 (coût all-in, décision du moteur).
    expect(trade.valueEur).toBe('1015');
    expect(trade.fee).toEqual({
      asset: 'eur',
      gross: '15',
      rebate: '0',
      grossEur: '15',
      rebateEur: '0',
    });
  });
});

describe('importGhostfolioJson — formats acceptés', () => {
  it('accepte un fichier nu { activities: [...] } sans meta ni accounts', () => {
    const bare = { activities: [FULL_EXPORT.activities[0]] };
    const result = importGhostfolioJson(JSON.stringify(bare), {}, ACCOUNT_ID, 'i1', USD_RATE);
    expect(result.ok).toBe(true);
  });

  it('refuse un JSON invalide', () => {
    const result = importGhostfolioJson('{ceci n’est pas du JSON', {}, ACCOUNT_ID, 'i1', USD_RATE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('JSON valide');
  });

  it('refuse un fichier sans tableau « activities »', () => {
    const result = importGhostfolioJson(
      JSON.stringify({ meta: { version: '2.100.0' } }),
      {},
      ACCOUNT_ID,
      'i1',
      USD_RATE,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.details.join(' ')).toContain('activities');
  });
});

describe('importGhostfolioJson — ré-import idempotent', () => {
  it('un second import ne crée aucun doublon', () => {
    const text = JSON.stringify(FULL_EXPORT);
    const first = importGhostfolioJson(text, {}, ACCOUNT_ID, 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = importGhostfolioJson(text, first.rows, ACCOUNT_ID, 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });
});

describe('importGhostfolioJson — activités malformées', () => {
  it('signale le type inconnu et la date illisible sans bloquer les autres activités', () => {
    const activities = [
      {
        accountId: 'acc-1',
        comment: null,
        fee: 1,
        id: 'ok-1',
        quantity: 0.01,
        type: 'BUY',
        unitPrice: 20000,
        currency: 'EUR',
        dataSource: 'COINGECKO',
        date: '2025-05-01T00:00:00.000Z',
        symbol: 'bitcoin',
        tags: [],
      },
      {
        accountId: 'acc-1',
        comment: null,
        fee: 0,
        id: 'bad-type',
        quantity: 0.01,
        type: 'TRANSFER', // type inconnu (hors des 6 valeurs Ghostfolio)
        unitPrice: 20000,
        currency: 'EUR',
        dataSource: 'COINGECKO',
        date: '2025-05-02T00:00:00.000Z',
        symbol: 'bitcoin',
        tags: [],
      },
      {
        accountId: 'acc-1',
        comment: null,
        fee: 0,
        id: 'ok-2',
        quantity: 0.2,
        type: 'DIVIDEND',
        unitPrice: 1800,
        currency: 'EUR',
        dataSource: 'COINGECKO',
        date: '2025-05-03T00:00:00.000Z',
        symbol: 'ethereum',
        tags: [],
      },
      {
        accountId: 'acc-1',
        comment: null,
        fee: 0,
        id: 'bad-date',
        quantity: 0.01,
        type: 'BUY',
        unitPrice: 20000,
        currency: 'EUR',
        dataSource: 'COINGECKO',
        date: 'pas-une-date', // date illisible
        symbol: 'bitcoin',
        tags: [],
      },
    ];
    const result = importGhostfolioJson(
      JSON.stringify({ activities }),
      {},
      ACCOUNT_ID,
      'i1',
      USD_RATE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.issues).toHaveLength(2);
    const byLine = new Map(result.report.issues.map((issue) => [issue.lineNo, issue.message]));
    expect(byLine.get(2)).toContain('inconnu');
    expect(byLine.get(4)).toContain('illisible');
    expect(result.report.parsedRows).toBe(2); // ok-1 (BUY) et ok-2 (DIVIDEND)
    expect(result.report.totalRows).toBe(4);
  });
});
