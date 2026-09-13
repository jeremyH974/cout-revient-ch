/**
 * Rejouer le grand livre, ou le réutiliser (décision n° 151).
 *
 * Le grand livre est la partie chère du calcul — 1,9 s pour 1 600 opérations à la mesure — et un
 * seul écran le rejouait **trois fois**. Le partager économise des secondes ; le partager mal
 * rendrait des chiffres faux, ce qui serait bien pire que lent.
 *
 * D'où la propriété que ce fichier surveille, et qui compte plus que le gain : **un grand livre qui
 * ne correspond pas aux entrées est IGNORÉ, jamais cru**. La vérification se fait par identité de
 * référence — comparer des milliers d'événements coûterait ce qu'on cherche à économiser — donc un
 * faux négatif ne coûte qu'un recalcul, et un faux positif est impossible.
 */
import { describe, expect, it, vi } from 'vitest';
import { computePortfolio, computePortfolioByAccount } from './aggregate';
import { ledgerMatches, runLedger } from './compute';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../types';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const buys: LedgerEvent[] = [
  buy('2025-01-02T10:00:00', 'btc', '0.5', '20000'),
  buy('2025-02-02T10:00:00', 'btc', '0.25', '12000'),
  sell('2025-03-02T10:00:00', 'btc', '0.3', '18000'),
];

/** Un jeu DIFFÉRENT, pour éprouver ce qui se passe quand on propose le mauvais grand livre. */
const others: LedgerEvent[] = [buy('2025-01-02T10:00:00', 'eth', '10', '30000')];

const settings = DEFAULT_ENGINE_SETTINGS;

describe('ledgerMatches', () => {
  it('reconnaît le grand livre joué sur exactement ces entrées', () => {
    expect(ledgerMatches(runLedger(buys, settings), buys, settings)).toBe(true);
  });

  it('refuse un grand livre joué sur d’autres événements', () => {
    expect(ledgerMatches(runLedger(others, settings), buys, settings)).toBe(false);
  });

  it('refuse un grand livre joué avec d’autres réglages', () => {
    const other = { ...settings, rewardValuation: 'fair-value' } as const;
    expect(ledgerMatches(runLedger(buys, other), buys, settings)).toBe(false);
  });

  it('refuse une copie des mêmes événements : l’identité est la garantie, pas l’égalité', () => {
    // Un faux négatif ne coûte qu'un recalcul. C'est le prix assumé d'une vérification en O(1).
    expect(ledgerMatches(runLedger(buys, settings), [...buys], settings)).toBe(false);
  });

  it('refuse l’absence de grand livre', () => {
    expect(ledgerMatches(undefined, buys, settings)).toBe(false);
  });
});

describe('computePortfolio — réutiliser ne change aucun chiffre', () => {
  const base = { events: buys, prices: {}, settings };

  it('rend exactement le même rapport avec et sans grand livre fourni', () => {
    const alone = computePortfolio(base);
    const shared = computePortfolio({ ...base, ledger: runLedger(buys, settings) });
    expect(JSON.stringify(shared)).toBe(JSON.stringify(alone));
  });

  /** La propriété qui compte : un grand livre étranger ne contamine pas le rapport. */
  it('ignore un grand livre étranger et rejoue, plutôt que de rendre un rapport faux', () => {
    const poisoned = computePortfolio({ ...base, ledger: runLedger(others, settings) });
    expect(JSON.stringify(poisoned)).toBe(JSON.stringify(computePortfolio(base)));
    expect(poisoned.positions.map((p) => p.asset)).toEqual(['btc']);
  });

  it('ignore un grand livre joué avec d’autres réglages', () => {
    const other = { ...settings, migrationMode: 'realize' } as const;
    const poisoned = computePortfolio({ ...base, ledger: runLedger(buys, other) });
    expect(JSON.stringify(poisoned)).toBe(JSON.stringify(computePortfolio(base)));
  });
});

describe('computePortfolioByAccount — même garantie', () => {
  const base = { events: buys, prices: {}, settings };

  it('rend les mêmes rapports par compte avec et sans grand livre fourni', () => {
    const alone = computePortfolioByAccount(base);
    const shared = computePortfolioByAccount({ ...base, ledger: runLedger(buys, settings) });
    expect([...shared.keys()]).toEqual([...alone.keys()]);
    for (const [accountId, report] of shared)
      expect(JSON.stringify(report), accountId).toBe(JSON.stringify(alone.get(accountId)));
  });

  it('ignore un grand livre étranger', () => {
    const poisoned = computePortfolioByAccount({ ...base, ledger: runLedger(others, settings) });
    expect(JSON.stringify([...poisoned])).toBe(
      JSON.stringify([...computePortfolioByAccount(base)]),
    );
  });
});

/**
 * Le garde-fou qui protège le gain, en COMPTANT plutôt qu'en chronométrant (décision n° 85).
 *
 * Un test de durée mesure surtout le bruit du runner ; celui-ci compte les rejeux du grand livre,
 * qui est une grandeur déterministe et la cause exacte du coût observé : 29,3 s pour ouvrir le
 * portefeuille sur 3 000 opérations, 162 ms une fois le rejeu supprimé.
 */
describe('combien de fois le grand livre est rejoué', () => {
  it('une seule fois pour un rapport, même en demandant la vue par compte', async () => {
    const runs: number[] = [];
    vi.resetModules();
    vi.doMock('./compute', async () => {
      const actual = await vi.importActual<typeof import('./compute')>('./compute');
      return {
        ...actual,
        runLedger: (...args: Parameters<typeof actual.runLedger>) => {
          runs.push(1);
          return actual.runLedger(...args);
        },
      };
    });
    const { computePortfolio: compute, computePortfolioByAccount: byAccount } =
      await import('./aggregate');
    const { runLedger: real } = await import('./compute');

    const ledger = real(buys, settings);
    runs.length = 0;
    compute({ events: buys, prices: {}, settings, ledger });
    expect(runs.length, 'rapport avec grand livre fourni').toBe(0);

    runs.length = 0;
    compute({ events: buys, prices: {}, settings });
    expect(runs.length, 'rapport sans grand livre fourni').toBe(1);

    runs.length = 0;
    byAccount({ events: buys, prices: {}, settings, ledger });
    // Le consolidé est repris ; chaque compte garde le sien, ses événements étant différents.
    expect(runs.length, 'vue par compte avec grand livre fourni').toBe(1);

    runs.length = 0;
    byAccount({ events: buys, prices: {}, settings });
    expect(runs.length, 'vue par compte sans grand livre fourni').toBe(2);
    vi.doUnmock('./compute');
    vi.resetModules();
  });
});
