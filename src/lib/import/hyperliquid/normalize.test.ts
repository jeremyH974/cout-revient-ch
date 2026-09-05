import { describe, expect, it } from 'vitest';
import type { HlFill, HlLedgerUpdate } from './api-types';
import { emptyHlAccountData } from './data';
import {
  fillToExecution,
  ledgerToCashFlow,
  normalizeHlAccount,
  spotFillToTradeEvent,
} from './normalize';

const ADDRESS = '0x000000000000000000000000000000000000d3a0';
const ACCOUNT = `hl:${ADDRESS}`;
const PAIRS = {
  'PURR/USDC': { base: 'PURR', quote: 'USDC' },
  '@107': { base: 'HYPE', quote: 'USDC' },
};

const fill = (over: Partial<HlFill>): HlFill => ({
  coin: 'BTC',
  px: '60000',
  sz: '0.1',
  side: 'B',
  time: Date.UTC(2026, 4, 1, 8, 30, 0),
  startPosition: '0',
  dir: 'Open Long',
  closedPnl: '0',
  hash: '0xh',
  oid: '1',
  crossed: true,
  fee: '2.7',
  tid: '1001',
  feeToken: 'USDC',
  builderFee: null,
  liquidation: null,
  twapId: null,
  ...over,
});
const ledger = (type: string, fields: HlLedgerUpdate['fields']): HlLedgerUpdate => ({
  time: Date.UTC(2026, 2, 2, 12),
  hash: '0xl',
  type,
  fields,
});

describe('fillToExecution', () => {
  it('perp : notionnel, frais en USDC, closedPnl brut conservé, heure de Paris', () => {
    const x = fillToExecution(
      fill({ side: 'A', closedPnl: '150', dir: 'Close Long' }),
      ACCOUNT,
      PAIRS,
    );
    expect(x).toMatchObject({
      id: 'hl:1001',
      market: 'perp',
      symbol: 'BTC',
      side: 'sell',
      notional: '6000',
      fee: '2.7',
      feeNative: null,
      closedPnl: '150',
      at: '2026-05-01T10:30:00',
    });
  });

  it('spot : paire résolue (@107 → HYPE), frais dans le jeton reçu = frais natifs', () => {
    const x = fillToExecution(
      fill({ coin: '@107', px: '30', sz: '10', fee: '0.007', feeToken: 'HYPE', dir: 'Buy' }),
      ACCOUNT,
      PAIRS,
    );
    expect(x).toMatchObject({
      market: 'spot',
      symbol: 'HYPE',
      quote: 'USDC',
      fee: '0',
      feeNative: { asset: 'HYPE', qty: '0.007' },
      closedPnl: '0',
    });
    expect(fillToExecution(fill({ coin: 'PURR/USDC' }), ACCOUNT, {}).symbol).toBe('PURR');
  });
});

describe('ledgerToCashFlow', () => {
  it('signe les flux vus du COMPTE ENTIER, perps et spot réunis', () => {
    const cases: [HlLedgerUpdate, string, string][] = [
      [ledger('deposit', { usdc: '5000' }), 'deposit', '5000'],
      [ledger('withdraw', { usdc: '1500', fee: '1', nonce: 1 }), 'withdrawal', '-1500'],
      /*
       * Virements internes : montant NUL depuis la décision n° 100. Les deux poches sont dans le
       * périmètre — déplacer de l'argent de l'une à l'autre ne fait rien entrer ni sortir. La
       * règle précédente comptait un virement vers le spot comme un retrait.
       */
      [ledger('accountClassTransfer', { usdc: '800', toPerp: false }), 'perp-to-spot', '0'],
      [ledger('accountClassTransfer', { usdc: '200', toPerp: true }), 'spot-to-perp', '0'],
      [
        ledger('internalTransfer', { usdc: '50', user: ADDRESS, destination: '0x1' }),
        'transfer-out',
        '-50',
      ],
      [
        ledger('internalTransfer', { usdc: '50', user: '0x1', destination: ADDRESS }),
        'transfer-in',
        '50',
      ],
      [ledger('vaultDeposit', { usdc: '100', vault: '0xv' }), 'vault-deposit', '-100'],
      /*
       * Transferts entre ADRESSES : de l'argent entre ou sort vraiment. Ils valaient zéro « faute
       * de sens documenté » ; l'API sert pourtant `usdcValue` et `user`/`destination`. Sur un
       * compte réel, cinq `send` entrants manquaient aux apports et l'écran annonçait une perte
       * de 100 % qui n'existait pas.
       */
      [
        ledger('spotTransfer', {
          token: 'HYPE',
          amount: '20',
          usdcValue: '640',
          user: '0x1',
          destination: ADDRESS,
        }),
        'transfer-in',
        '640',
      ],
      [
        ledger('send', {
          token: 'USDC',
          amount: '901.48',
          usdcValue: '901.48',
          user: '0x1',
          destination: ADDRESS,
        }),
        'transfer-in',
        '901.48',
      ],
      [
        ledger('send', { token: 'USDC', amount: '10', usdcValue: '10', user: ADDRESS }),
        'transfer-out',
        '-10',
      ],
    ];
    for (const [entry, kind, amount] of cases) {
      const { flow, known } = ledgerToCashFlow(entry, ACCOUNT, ADDRESS);
      expect([flow.kind, flow.amount, known]).toEqual([kind, amount, true]);
    }
    expect(ledgerToCashFlow(ledger('mystery', {}), ACCOUNT, ADDRESS).known).toBe(false);
  });
});

describe('spotFillToTradeEvent', () => {
  const buy = fillToExecution(
    fill({ coin: 'PURR/USDC', px: '0.2', sz: '1000', fee: '0.7', feeToken: 'PURR', dir: 'Buy' }),
    ACCOUNT,
    PAIRS,
  );

  it('achat : contrepartie en euros au taux du jour, quantité nette des frais en jeton', () => {
    const event = spotFillToTradeEvent(buy, () => '1.1');
    expect(event).toMatchObject({
      kind: 'trade',
      accountId: ACCOUNT,
      scope: 'external',
      source: 'hyperliquid-api',
      out: { asset: 'eur', qty: '181.818181818181818181818181818182' },
      in: { asset: 'purr', qty: '999.3' },
      valueEur: '181.818181818181818181818181818182',
      fee: null,
      warnings: [],
      quotePrice: { asset: 'usdc', price: '0.2' },
    });
  });

  it('vente : frais USDC déduits du produit, frais consignés', () => {
    const sell = fillToExecution(
      fill({ coin: 'PURR/USDC', px: '0.25', sz: '500', side: 'A', fee: '0.0875', dir: 'Sell' }),
      ACCOUNT,
      PAIRS,
    );
    const event = spotFillToTradeEvent(sell, () => '1.25');
    // (125 − 0,0875) ÷ 1,25 = 99,93
    expect(event).toMatchObject({
      out: { asset: 'purr', qty: '500' },
      in: { asset: 'eur', qty: '99.93' },
      valueEur: '99.93',
      fee: { asset: 'usdc', gross: '0.0875', rebate: '0', grossEur: '0.07', rebateEur: '0' },
    });
  });

  it('sans taux : aucun événement', () => {
    expect(spotFillToTradeEvent(buy, () => null)).toBeNull();
  });
});

describe('normalizeHlAccount', () => {
  it('sépare trading et investissement selon spotAsInvestment et compte les conversions manquantes', () => {
    const data = emptyHlAccountData(ADDRESS);
    for (const f of [
      fill({ tid: '1' }),
      fill({
        tid: '2',
        coin: 'PURR/USDC',
        px: '0.2',
        sz: '100',
        fee: '0.07',
        feeToken: 'PURR',
        dir: 'Buy',
      }),
    ])
      data.fills[f.tid] = f;
    data.ledger['d'] = ledger('deposit', { usdc: '100' });
    const off = normalizeHlAccount(data, {
      accountId: ACCOUNT,
      spotPairs: PAIRS,
      spotAsInvestment: false,
      eurUsdRate: () => '1.1',
    });
    expect(off.trading.executions.map((x) => x.market)).toEqual(['perp', 'spot']);
    expect(off.investEvents).toEqual([]);
    expect(off.trading.cashFlows).toHaveLength(1);
    const on = normalizeHlAccount(data, {
      accountId: ACCOUNT,
      spotPairs: PAIRS,
      spotAsInvestment: true,
      eurUsdRate: () => '1.1',
    });
    expect(on.trading.executions.map((x) => x.market)).toEqual(['perp']);
    expect(on.investEvents).toHaveLength(1);
    const noFx = normalizeHlAccount(data, {
      accountId: ACCOUNT,
      spotPairs: PAIRS,
      spotAsInvestment: true,
      eurUsdRate: () => null,
    });
    expect(noFx.investEvents).toEqual([]);
    expect(noFx.fxMissing).toBe(1);
  });
});

/**
 * La frontière fiscale, nommée (décision n° 83).
 *
 * Le test ci-dessus vérifie la séparation comme un effet de la conversion `spotAsInvestment`.
 * Celui-ci la nomme pour ce qu'elle est : **aucun perpetual ne devient jamais un événement
 * d'Investissement**, quel que soit le réglage. C'est ce qui garde l'estimation fiscale hors du
 * régime des dérivés — vraisemblablement l'article 150 ter du CGI, distinct du 150 VH bis, et dont
 * la qualification pour un perpetual DeFi n'est tranchée par aucune source primaire trouvée.
 *
 * Aujourd'hui c'est vrai par construction. Demain, ce sera vrai parce que ce test le dit.
 */
describe('frontière fiscale : les perpetuals restent hors de l’Investissement', () => {
  const withBothMarkets = () => {
    const data = emptyHlAccountData(ADDRESS);
    for (const f of [
      fill({ tid: 'p1' }), // perp
      fill({
        tid: 's1',
        coin: 'PURR/USDC',
        px: '0.2',
        sz: '100',
        fee: '0.07',
        feeToken: 'PURR',
        dir: 'Buy',
      }), // spot
    ])
      data.fills[f.tid] = f;
    return data;
  };

  for (const spotAsInvestment of [false, true]) {
    it(`aucun perpetual dans investEvents (spotAsInvestment: ${spotAsInvestment})`, () => {
      const out = normalizeHlAccount(withBothMarkets(), {
        accountId: ACCOUNT,
        spotPairs: PAIRS,
        spotAsInvestment,
        eurUsdRate: () => '1.1',
      });
      // Un événement d'Investissement ne peut venir que d'un fill spot : on le prouve par l'origine
      // de son identifiant, le seul lien qui remonte au fill.
      for (const event of out.investEvents)
        expect(event.id, `« ${event.id} » vient d’un perpetual`).not.toContain('p1');
      // Et les perps restent bien du côté trading, où ils sont comptés mais jamais imposés ici.
      expect(out.trading.executions.some((x) => x.market === 'perp')).toBe(true);
    });
  }
});
