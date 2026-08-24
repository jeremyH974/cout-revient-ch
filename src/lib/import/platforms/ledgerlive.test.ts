/**
 * Convertisseur Ledger Live : OUT dont le montant inclut déjà les frais réseau (pas de jambe de
 * frais séparée, juste une mention), DELEGATE à 0 frais (interne) vs. > 0 (sortie au coût « cost »),
 * REWARD, NFT non géré, type inconnu, statut non confirmé ignoré, variante d'en-tête sans colonne
 * Status — et aval complet (idempotence incluse).
 */
import { describe, expect, it } from 'vitest';
import { importAnyCsv } from './index';
import { ledgerLive } from './ledgerlive';
import { parseCsvText } from '../csv';

const USD_RATE = (): string => '1.1';

const HEADER = [
  'Operation Date',
  'Status',
  'Currency Ticker',
  'Operation Type',
  'Operation Amount',
  'Operation Fees',
  'Operation Hash',
  'Account Name',
  'Countervalue Ticker',
  'Countervalue at Operation Date',
  'Countervalue at CSV Export',
];

const ROWS: string[][] = [
  [
    '2025-01-15T10:22:04Z',
    'CONFIRMED',
    'BTC',
    'IN',
    '0.5',
    '0',
    '0xabc123',
    'Ledger Nano X',
    'EUR',
    '30000',
    '31000',
  ],
  [
    '2025-01-16T11:00:00Z',
    'CONFIRMED',
    'ETH',
    'OUT',
    '0.3',
    '0.001',
    '0xdef456',
    'Ledger Nano X',
    'EUR',
    '900',
    '950',
  ],
  [
    '2025-01-17T09:00:00Z',
    'CONFIRMED',
    'ATOM',
    'REWARD',
    '1.25',
    '0',
    '0xreward1',
    'Ledger Nano X',
    'EUR',
    '10',
    '11',
  ],
  [
    '2025-01-18T09:00:00Z',
    'CONFIRMED',
    'ATOM',
    'DELEGATE',
    '0',
    '0',
    '0xdeleg1',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  [
    '2025-01-19T09:00:00Z',
    'CONFIRMED',
    'ATOM',
    'DELEGATE',
    '0',
    '0.01',
    '0xdeleg2',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  [
    '2025-01-20T09:00:00Z',
    'CONFIRMED',
    'ATOM',
    'UNBOND',
    '0',
    '0',
    '0xunbond1',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  [
    '2025-01-21T09:00:00Z',
    'CONFIRMED',
    'ETH',
    'NFT_OUT',
    '1',
    '0.002',
    '0xnft1',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  [
    '2025-01-22T09:00:00Z',
    'CONFIRMED',
    'XYZ',
    'WEIRDOP',
    '1',
    '0',
    '0xweird1',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  [
    '2025-01-23T09:00:00Z',
    'PENDING',
    'BTC',
    'IN',
    '0.1',
    '0',
    '0xpending1',
    'Ledger Nano X',
    '',
    '',
    '',
  ],
  ['2025-01-24T09:00:00Z', 'CONFIRMED', 'SOL', 'IN', '2', '0', '', '', '', '', ''],
];

const CSV = [HEADER.join(','), ...ROWS.map((r) => r.join(','))].join('\n');

describe('ledgerLive', () => {
  it('détecte l’en-tête (avec ou sans colonne Status)', () => {
    expect(ledgerLive.detect(parseCsvText(CSV).header)).toBe(true);
    expect(
      ledgerLive.detect([
        'Operation Date',
        'Currency Ticker',
        'Operation Type',
        'Operation Amount',
        'Operation Fees',
      ]),
    ).toBe(true);
    expect(ledgerLive.detect(['Operation Date', 'Currency Ticker'])).toBe(false);
  });

  it('convertit IN/OUT/REWARD/DELEGATE, NFT et type inconnu en issue, statut non confirmé ignoré', () => {
    const { drafts, issues, skippedInternal } = ledgerLive.convert(parseCsvText(CSV));
    expect(drafts).toHaveLength(5);
    // DELEGATE à 0 frais + UNBOND à 0 frais.
    expect(skippedInternal).toBe(2);
    // NFT_OUT, type inconnu (WEIRDOP), statut PENDING.
    expect(issues).toHaveLength(3);
    expect(issues.some((i) => i.message.includes('NFT'))).toBe(true);
    expect(issues.some((i) => i.message.includes('WEIRDOP'))).toBe(true);
    expect(issues.some((i) => i.message.includes('PENDING'))).toBe(true);

    const byHash = (hash: string): (typeof drafts)[number] => {
      const d = drafts.find((x) => x.txHash === hash);
      if (!d) throw new Error(`draft ${hash} introuvable`);
      return d;
    };

    const inRow = byHash('0xabc123');
    expect(inRow.received).toEqual({ amount: '0.5', currency: 'btc' });
    expect(inRow.sent).toBeNull();
    expect(inRow.fee).toBeNull();
    expect(inRow.description).toBe('Compte Ledger : Ledger Nano X');
    expect(inRow.timeMs).toBe(Date.UTC(2025, 0, 15, 10, 22, 4));

    const outRow = byHash('0xdef456');
    // Amount = total débité, frais réseau déjà inclus : pas de jambe de frais, montant intact.
    expect(outRow.sent).toEqual({ amount: '0.3', currency: 'eth' });
    expect(outRow.fee).toBeNull();
    expect(outRow.description).toContain('frais réseau 0.001 ETH inclus');

    const reward = byHash('0xreward1');
    expect(reward.received).toEqual({ amount: '1.25', currency: 'atom' });
    expect(reward.label).toBe('staking');

    const delegateWithFee = byHash('0xdeleg2');
    expect(delegateWithFee.sent).toEqual({ amount: '0.01', currency: 'atom' });
    expect(delegateWithFee.label).toBe('cost');

    // Pas de hash ni de compte : txHash null, pas de mention « Compte Ledger ».
    const noAccount = drafts.find((d) => d.received?.currency === 'sol')!;
    expect(noAccount.txHash).toBeNull();
    expect(noAccount.description).toBeNull();
  });

  it('variante d’en-tête sans colonne Status : aucun filtrage de statut', () => {
    const header2 = [
      'Operation Date',
      'Currency Ticker',
      'Operation Type',
      'Operation Amount',
      'Operation Fees',
      'Operation Hash',
      'Account Name',
      'Countervalue Ticker',
      'Countervalue at Operation Date',
      'Countervalue at CSV Export',
    ].join(',');
    const row2 = [
      '2025-02-01T08:00:00Z',
      'BTC',
      'IN',
      '0.1',
      '0',
      '0xnostatus1',
      'Secondary',
      '',
      '',
      '',
    ].join(',');
    const csv2 = [header2, row2].join('\n');
    expect(ledgerLive.detect(parseCsvText(csv2).header)).toBe(true);
    const { drafts, issues } = ledgerLive.convert(parseCsvText(csv2));
    expect(issues).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.received).toEqual({ amount: '0.1', currency: 'btc' });
    expect(drafts[0]!.description).toBe('Compte Ledger : Secondary');
  });
});

describe('importAnyCsv (ledger-live)', () => {
  it('produit les événements attendus et un ré-import idempotent', () => {
    const first = importAnyCsv(CSV, {}, 'csv:ledgerlive', 'i1', USD_RATE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.report.format).toBe('ledger-live');
    expect(first.report.counts.skippedInternal).toBe(2);
    for (const key of Object.keys(first.rows))
      expect(key.startsWith('pv:csv:ledgerlive:')).toBe(true);

    const again = importAnyCsv(CSV, first.rows, 'csv:ledgerlive', 'i2', USD_RATE);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.report.newRows).toBe(0);
    expect(again.report.duplicateRows).toBe(first.report.parsedRows);
    expect(again.report.conflictingRows).toBe(0);
  });
});
