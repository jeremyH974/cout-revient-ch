/**
 * Ordre des fills : un ordre qui traverse le carnet produit des dizaines d'exécutions à la MÊME
 * milliseconde, et leur `tid` ne dit pas laquelle est passée en premier. Ces tests tiennent la règle
 * qui remet la séquence d'aplomb (`startPosition`), et surtout son refus — un paquet dont la chaîne
 * ne se prouve pas est rendu tel quel, jamais deviné. Décision n° 129.
 */
import { describe, expect, it } from 'vitest';
import { buildRoundTrips } from '../../domain/trading/round-trips';
import type { HlFill } from './api-types';
import { sortedFills } from './data';
import { fillToExecution } from './normalize';

const ACCOUNT = 'hl:0xtest';
const MS = Date.UTC(2026, 8, 8, 15, 45, 0);

const fill = (over: Partial<HlFill>): HlFill => ({
  coin: 'BTC',
  px: '100',
  sz: '1',
  side: 'B',
  time: MS,
  startPosition: '0',
  dir: 'Open Long',
  closedPnl: '0',
  hash: '0xh',
  oid: '1',
  crossed: true,
  fee: '0',
  tid: '5000',
  feeToken: 'USDC',
  builderFee: null,
  liquidation: null,
  twapId: null,
  ...over,
});

const record = (fills: readonly HlFill[]): Record<string, HlFill> =>
  Object.fromEntries(fills.map((f) => [f.tid, f]));

/**
 * Huit tranches d'un même ordre, au même instant : la plateforme les décrit par une position qui
 * monte de 0 à 7, mais leurs `tid` sont dans l'ordre INVERSE — le pire cas, et le plus instructif.
 */
const ORDER_IN_ONE_MS = Array.from({ length: 8 }, (_, rank) =>
  fill({
    tid: `50${(8 - rank).toString().padStart(2, '0')}`,
    startPosition: String(rank),
    px: String(100 + rank),
  }),
);

describe('sortedFills', () => {
  it('remet les tranches d’un même ordre dans leur ordre d’exécution, pas dans celui des tid', () => {
    const sorted = sortedFills(record(ORDER_IN_ONE_MS));
    expect(sorted.map((f) => f.startPosition)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('et la reconstruction y voit UN aller-retour complet, pas huit historiques partiels', () => {
    const executions = sortedFills(record(ORDER_IN_ONE_MS)).map((f) =>
      fillToExecution(f, ACCOUNT, {}),
    );
    const trips = buildRoundTrips(executions);
    expect(trips).toHaveLength(1);
    const trip = trips[0]!;
    expect(trip.incomplete).toBe(false);
    expect(trip.qtyOpened.toString()).toBe('8');
    // Moyenne de 100 à 107 : la seule entrée qu'on puisse afficher sans mentir.
    expect(trip.avgEntry?.toString()).toBe('103.5');
  });

  it('chaque symbole a sa propre chaîne : deux ordres au même instant ne se mélangent pas', () => {
    const eth = [
      fill({ coin: 'ETH', tid: '6002', startPosition: '2', sz: '2' }),
      fill({ coin: 'ETH', tid: '6001', startPosition: '0', sz: '2' }),
    ];
    const sorted = sortedFills(record([...ORDER_IN_ONE_MS, ...eth]));
    expect(sorted.filter((f) => f.coin === 'BTC').map((f) => f.startPosition)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(sorted.filter((f) => f.coin === 'ETH').map((f) => f.startPosition)).toEqual(['0', '2']);
    expect(sorted).toHaveLength(10);
  });

  it('un instant sans ambiguïté (un seul fill) reste tel quel', () => {
    const one = [fill({ tid: '7001', startPosition: '3' })];
    expect(sortedFills(record(one)).map((f) => f.tid)).toEqual(['7001']);
  });

  it('une position ouverte PUIS refermée dans la milliseconde n’a pas de tête : on ne devine pas', () => {
    // Départ 0 → +1 → retour à 0 : la chaîne est un cycle, aucune tranche n'est identifiable comme
    // la première. Le paquet est rendu dans l'ordre reçu, et c'est le garde-fou de la
    // reconstruction qui parlera — bruyamment, mais sans inventer d'entrée moyenne.
    const cycle = [
      fill({ tid: '8001', startPosition: '1', side: 'A', dir: 'Close Long' }),
      fill({ tid: '8002', startPosition: '0' }),
    ];
    // L'attendu est l'ordre REÇU (1 puis 0), et non la chaîne plausible (0 puis 1) : c'est ce qui
    // distingue un refus d'une devinette qui serait tombée juste.
    expect(sortedFills(record(cycle)).map((f) => f.startPosition)).toEqual(['1', '0']);
  });

  it('une chaîne trouée est rendue intacte plutôt que recousue au hasard', () => {
    // Le fill qui menait de 1 à 2 manque (purge de l'API) : la chaîne casse au deuxième maillon.
    const holed = [
      fill({ tid: '9001', startPosition: '2' }),
      fill({ tid: '9003', startPosition: '0' }),
    ];
    // Là encore l'ordre reçu (2 puis 0), pas la chaîne que l'on aurait aimé lire (0 puis 2).
    expect(sortedFills(record(holed)).map((f) => f.startPosition)).toEqual(['2', '0']);
  });
});
