/**
 * Revenus en espèces : dividendes, intérêts de trésorerie, frais de conversion.
 *
 * Trois propriétés se jouent ici, et chacune a coûté un défaut avant d'être écrite :
 *
 * 1. **Le brut compte, la retenue se suit à part.** Un dividende étranger arrive net d'une retenue
 *    à la source ; c'est le brut qui se déclare, et la retenue qui ouvre le crédit d'impôt
 *    conventionnel. L'agréger au net la perdrait.
 * 2. **Un revenu de compte ne touche aucun prix de revient.** Des intérêts de trésorerie
 *    n'appartiennent à aucune ligne : les y répartir serait arbitraire.
 * 3. **Un revenu n'entre pas dans l'assiette du 150 VH bis.** Ce n'est ni une acquisition ni une
 *    cession d'actif numérique.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio } from './engine/aggregate';
import { toDecimalString } from './money';
import { computeFrenchTax, taxKindOf } from './tax-fr';
import {
  DEFAULT_ENGINE_SETTINGS,
  type IncomeEvent,
  type LedgerEvent,
  type TradeEvent,
} from './types';

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
const income = (at: string, gross: string, over: Partial<IncomeEvent> = {}): IncomeEvent => ({
  ...base(),
  kind: 'income',
  at,
  asset: null,
  grossEur: gross,
  withheldEur: '0',
  nature: 'interest',
  label: 'Intérêts',
  ...over,
});

const report = (events: LedgerEvent[]) =>
  computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });

describe('revenus en espèces', () => {
  it('un dividende compte en BRUT sur sa ligne, retenue suivie à part', () => {
    const r = report([
      buy('2026-01-02T10:00:00', 'eq:aapl', '10', '3000'),
      income('2026-03-01T00:00:00', '100', {
        asset: 'eq:aapl',
        withheldEur: '15',
        nature: 'dividend',
      }),
    ]);
    const position = r.equities.find((p) => p.asset === 'eq:aapl');
    // 100 €, pas 85 : le net reçu ne dit pas ce qu'il faut déclarer.
    expect(toDecimalString(position!.otherIncome)).toBe('100');
    expect(toDecimalString(r.totals.withheldEur)).toBe('15');
    // Le revenu n'est PAS un revenu de compte : il appartient à la ligne.
    expect(toDecimalString(r.totals.accountIncomeEur)).toBe('0');
  });

  it('un revenu de compte ne touche aucun prix de revient', () => {
    const r = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      income('2026-03-01T00:00:00', '189.31'),
    ]);
    const btc = r.positions.find((p) => p.asset === 'btc');
    expect(toDecimalString(btc!.costBasis)).toBe('50000');
    expect(toDecimalString(btc!.otherIncome)).toBe('0');
    expect(toDecimalString(r.totals.accountIncomeEur)).toBe('189.31');
  });

  it('un montant négatif est un coût : les frais de conversion baissent le résultat', () => {
    const gain = report([buy('2026-01-02T10:00:00', 'btc', '1', '50000')]);
    const withFees = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      income('2026-03-01T00:00:00', '-297.52', { nature: 'conversion-fee', label: 'Conversion' }),
    ]);
    const diff = withFees.totals.total.minus(gain.totals.total);
    expect(toDecimalString(diff)).toBe('-297.52');
  });

  it('n’entre pas dans l’assiette du 150 VH bis', () => {
    // On interroge la fonction QUI DÉCIDE, et pas seulement son effet : sans valeur globale du
    // portefeuille, un revenu requalifié en cession ne changerait aucun chiffre, et le test
    // resterait vert. La contre-épreuve de la décision n° 75 l'a montré.
    expect(taxKindOf(income('2026-03-01T00:00:00', '500', { nature: 'dividend' }))).toBe('ignored');

    // Et l'effet, tout de même : ni acquisition ni cession, le prix total d'acquisition ne bouge.
    const withIncome = computeFrenchTax({
      events: [
        buy('2026-01-02T10:00:00', 'btc', '1', '1000'),
        income('2026-03-01T00:00:00', '500', { nature: 'dividend' }),
      ],
    });
    expect(withIncome.ptaAfter).toBe('1000');
    expect(withIncome.cessions).toEqual([]);
  });
});
