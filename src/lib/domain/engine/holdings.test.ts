/**
 * `holdings()` est la réponse à un défaut qui ne se voyait nulle part : une douzaine d'appelants
 * recopiaient `[...positions, ...stablecoins]` de mémoire, et six ont oublié `equities` quand la
 * classe est née. Le plus coûteux, `heldAssets`, privait les titres de toute cotation.
 */
import { describe, expect, it } from 'vitest';
import { equityCode, type AssetClass } from '../assets';
import { D, toDecimalString } from '../money';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../types';
import { computePortfolio } from './aggregate';
import { allPositions, closedExcept, closedOfClass, holdings } from './report';

let seq = 0;
const buy = (at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  id: `t${++seq}`,
  source: 'manual',
  scope: 'coinhouse',
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
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
  ...buy(at, asset, qty, eur),
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
});

const report = (events: LedgerEvent[]) =>
  computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });

describe('positions toutes classes', () => {
  it('rend la crypto, le stablecoin et le titre — pas seulement les deux premiers', () => {
    const r = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      buy('2026-01-02T11:00:00', 'usdc', '1000', '1000'),
      buy('2026-01-02T12:00:00', equityCode('AAPL'), '10', '3000'),
    ]);
    const codes = holdings(r)
      .map((p) => p.asset)
      .sort();
    expect(codes).toEqual(['btc', 'eq:aapl', 'usdc']);
  });

  it('couvre toutes les valeurs d’AssetClass : une classe nouvelle ne peut plus être oubliée', () => {
    // Le `satisfies` du module fait échouer la COMPILATION si une classe manque ; ce test dit la
    // même chose à l'exécution, et nomme la classe orpheline plutôt qu'un écran vide.
    const r = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      buy('2026-01-02T11:00:00', 'usdc', '1000', '1000'),
      buy('2026-01-02T12:00:00', equityCode('AAPL'), '10', '3000'),
    ]);
    const seen = new Set(holdings(r).map((p) => p.assetClass));
    // Les espèces ne forment jamais une position : le moteur les écarte en amont.
    const expected: AssetClass[] = ['crypto', 'stablecoin', 'equity'];
    for (const klass of expected) expect(seen).toContain(klass);
  });

  it('inclut les clôturées et les bloquées quand on demande tout', () => {
    const r = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      buy('2026-01-03T10:00:00', equityCode('AAPL'), '10', '3000'),
      sell('2026-01-04T10:00:00', equityCode('AAPL'), '10', '3500'),
    ]);
    expect(holdings(r).map((p) => p.asset)).toEqual(['btc']);
    expect(
      allPositions(r)
        .map((p) => p.asset)
        .sort(),
    ).toEqual(['btc', 'eq:aapl']);
  });

  it('sépare les clôturées par classe : un titre cédé n’est pas une crypto clôturée', () => {
    // Sans ce tri, le titre s'affichait dans le portefeuille crypto ET au Patrimoine, et sa
    // plus-value boursière gonflait le « P&L des clôturées » de la crypto.
    const r = report([
      buy('2026-01-02T10:00:00', 'btc', '1', '50000'),
      sell('2026-01-03T10:00:00', 'btc', '1', '55000'),
      buy('2026-01-03T11:00:00', equityCode('AAPL'), '10', '3000'),
      sell('2026-01-04T10:00:00', equityCode('AAPL'), '10', '3500'),
    ]);
    expect(closedOfClass(r, 'equity').map((p) => p.asset)).toEqual(['eq:aapl']);
    expect(closedExcept(r, 'equity').map((p) => p.asset)).toEqual(['btc']);
    expect(toDecimalString(D(closedExcept(r, 'equity')[0]!.realized))).toBe('5000');
  });
});
