import { describe, expect, it } from 'vitest';
import { D } from './money';
import {
  MIN_ASSET_SAMPLES,
  MIN_SPREAD_SAMPLES,
  estimateSpread,
  type ReferenceLookup,
} from './spread';
import type { LedgerEvent, TradeEvent } from './types';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'coinhouse-csv' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});

/** Achat en euros à un prix affiché ; la contre-valeur suit le prix pour rester cohérente. */
const buy = (at: string, asset: string, quote: string, valueEur = '1000'): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: valueEur },
  in: { asset, qty: '1' },
  valueEur,
  valueEurSource: 'counter-leg',
  fee: null,
  quotePrice: { asset: 'eur', price: quote },
});

const sell = (at: string, asset: string, quote: string, valueEur = '1000'): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset, qty: '1' },
  in: { asset: 'eur', qty: valueEur },
  valueEur,
  valueEurSource: 'counter-leg',
  fee: null,
  quotePrice: { asset: 'eur', price: quote },
});

/** Référence constante : le cours « du marché » vaut 100 pour tous les actifs, tous les jours. */
const flatReference: ReferenceLookup = () => D('100');
const noReference: ReferenceLookup = () => null;

const day = (i: number): string => `2026-0${1 + (i % 9)}-1${i % 10}T10:00:00`;

describe('estimateSpread', () => {
  it('mesure un surcoût POSITIF dans les deux sens : acheter plus cher, vendre moins cher', () => {
    // Achat à 101 quand le marché est à 100 → +1 % ; vente à 99 → +1 % aussi.
    const result = estimateSpread(
      [buy(day(1), 'btc', '101'), sell(day(2), 'btc', '99')],
      flatReference,
    );
    expect(result.samples).toBe(2);
    expect(result.medianDeviation).toBe('0.01');
    expect(result.samplesDetail.every((s) => D(s.deviation).gt('0'))).toBe(true);
  });

  it('donne un surcoût NÉGATIF quand la plateforme a été plus favorable que la référence', () => {
    const result = estimateSpread([buy(day(1), 'btc', '99')], flatReference);
    expect(D(result.medianDeviation!).lt('0')).toBe(true);
  });

  it('isole le spread systématique du bruit de la journée grâce à la médiane', () => {
    // Un spread constant de +1 %, noyé dans un bruit symétrique de ±10 % sur chaque opération.
    const noise = [10, -10, 8, -8, 6, -6, 4, -4, 2, -2, 9, -9, 7, -7, 5, -5, 3, -3, 1, -1];
    const events: LedgerEvent[] = noise.map((n, i) =>
      buy(
        day(i),
        'btc',
        D('100')
          .times(D('1.01').plus(D(String(n)).div('100')))
          .toString(),
      ),
    );
    const result = estimateSpread(events, flatReference);
    expect(result.samples).toBe(noise.length);
    expect(result.reliable).toBe(true);
    // La médiane retrouve le 1 % systématique ; la moyenne aussi ici, le bruit étant symétrique.
    expect(D(result.medianDeviation!).minus('0.01').abs().lt('0.001')).toBe(true);
  });

  it('résiste à une journée aberrante là où la moyenne dérape', () => {
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(buy(day(i), 'btc', '101'));
    // Une seule opération un jour de krach : le cours quotidien n'a rien à voir avec l'instant.
    events.push(buy(day(21), 'btc', '400'));
    const result = estimateSpread(events, flatReference);
    expect(result.medianDeviation).toBe('0.01');
    // La moyenne, elle, est emportée : c'est pourquoi l'affichage retient la médiane.
    expect(D(result.meanDeviation!).gt('0.1')).toBe(true);
  });

  it('n’estime le coût qu’à partir de la médiane et du volume, jamais opération par opération', () => {
    const events: LedgerEvent[] = [
      buy(day(1), 'btc', '101', '1000'),
      buy(day(2), 'btc', '101', '3000'),
    ];
    const result = estimateSpread(events, flatReference);
    expect(result.volumeEur).toBe('4000');
    // 1 % de 4 000 € = 40 €.
    expect(result.estimatedCostEur).toBe('40');
  });

  it('déclare son estimation non fiable sous le seuil d’échantillon', () => {
    const few = estimateSpread([buy(day(1), 'btc', '101')], flatReference);
    expect(few.reliable).toBe(false);
    const enough: LedgerEvent[] = [];
    for (let i = 0; i < MIN_SPREAD_SAMPLES; i++) enough.push(buy(day(i), 'btc', '101'));
    expect(estimateSpread(enough, flatReference).reliable).toBe(true);
  });

  it('écarte et COMPTE ce qu’il ne peut pas comparer', () => {
    const noQuote: TradeEvent = { ...buy(day(1), 'btc', '101'), quotePrice: null };
    const usdcQuoted: TradeEvent = {
      ...buy(day(2), 'sol', '101'),
      quotePrice: { asset: 'usdc', price: '101' },
    };
    const result = estimateSpread([noQuote, usdcQuoted, buy(day(3), 'btc', '101')], flatReference);
    expect(result.samples).toBe(1);
    expect(result.skipped.noQuotePrice).toBe(1);
    // Convertir une cotation en USDC ajouterait le bruit du change à celui de la journée.
    expect(result.skipped.notEurQuoted).toBe(1);

    const blind = estimateSpread([buy(day(1), 'btc', '101')], noReference);
    expect(blind.samples).toBe(0);
    expect(blind.skipped.noReference).toBe(1);
    expect(blind.medianDeviation).toBeNull();
    expect(blind.estimatedCostEur).toBe('0');
  });

  it('ignore les échanges crypto↔crypto et les autres sources', () => {
    const swap: TradeEvent = {
      ...base(),
      kind: 'trade',
      at: day(1),
      out: { asset: 'btc', qty: '1' },
      in: { asset: 'eth', qty: '20' },
      valueEur: '1000',
      valueEurSource: 'counter-leg',
      fee: null,
      quotePrice: { asset: 'eur', price: '101' },
    };
    const other: TradeEvent = { ...buy(day(2), 'btc', '101'), source: 'pivot-csv' };
    expect(estimateSpread([swap, other], flatReference).samples).toBe(0);
  });

  it('classe les actifs du coût estimé le plus élevé au plus faible', () => {
    const events: LedgerEvent[] = [];
    for (let i = 0; i < MIN_ASSET_SAMPLES; i++) {
      events.push(buy(day(i), 'btc', '101', '2000'));
      events.push(buy(day(i), 'ada', '105', '100'));
    }
    const result = estimateSpread(events, flatReference);
    // BTC : 1 % de 10 000 = 100 € ; ADA : 5 % de 500 = 25 €.
    expect(result.byAsset.map((a) => a.asset)).toEqual(['btc', 'ada']);
    expect(result.byAsset[0]!.estimatedCostEur).toBe('100');
    expect(result.byAsset[1]!.estimatedCostEur).toBe('25');
  });
});

describe('ventilation par actif : pas de médiane sur une poignée d’opérations', () => {
  it('écarte les actifs sous le seuil, si coûteux soient-ils en apparence', () => {
    const events: LedgerEvent[] = [];
    // BTC : assez d'opérations pour une médiane.
    for (let i = 0; i < MIN_ASSET_SAMPLES; i++) events.push(buy(day(i), 'btc', '101', '1000'));
    // MKR : une seule opération, très défavorable — c'est un écart d'un jour, pas un spread.
    events.push(buy(day(9), 'mkr', '114', '900'));
    const result = estimateSpread(events, flatReference);
    expect(result.samples).toBe(MIN_ASSET_SAMPLES + 1);
    expect(result.byAsset.map((a) => a.asset)).toEqual(['btc']);
  });
});
