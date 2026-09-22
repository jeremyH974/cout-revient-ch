import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from '../money';
import {
  EMPTY_FILTER,
  activeFacetCount,
  applyFilter,
  facetOptions,
  isFilterActive,
  needsAnnotation,
  summarizeFiltered,
  type FilterContext,
  type TradeFilter,
} from './filter';
import { emptyJournalEntry, type JournalEntry, type JournaledTrip } from './journal';
import type { RoundTrip } from './round-trips';
import { computeStats, tripsClosedIn } from './stats';

let seq = 0;
const rt = (over: Partial<RoundTrip> = {}): RoundTrip => {
  seq += 1;
  const closedAt = over.closedAt !== undefined ? over.closedAt : '2026-08-01T10:00:00';
  return {
    id: `rt:hl:a:BTC:${seq}`,
    accountId: 'hl:a',
    market: 'perp',
    symbol: 'BTC',
    quote: 'USD',
    direction: 'long',
    status: 'closed',
    openedAt: '2026-08-01T09:00:00',
    openedTime: seq,
    closedAt,
    closedTime: closedAt === null ? null : seq,
    executionIds: [],
    qtyOpened: D('1'),
    qtyClosed: D('1'),
    qtyMax: D('1'),
    avgEntry: D('100'),
    avgExit: D('110'),
    grossPnl: D('10'),
    fees: D('0'),
    funding: D('0'),
    netPnl: D('10'),
    holdSeconds: 3_600,
    liquidated: false,
    incomplete: false,
    source: 'hyperliquid-api',
    ...over,
  };
};

const journalEntry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  ...emptyJournalEntry('x'),
  ...over,
});

const jt = (
  overTrip: Partial<RoundTrip> = {},
  journal: JournalEntry | null = null,
): JournaledTrip => ({
  trip: rt(overTrip),
  journal,
  r: null,
  entrySlippage: null,
});

const LABELS: Record<string, string> = { 'hl:a': 'Compte principal', 'hl:b': 'Compte secondaire' };
const ctx: FilterContext = { accountLabel: (id) => LABELS[id] ?? id };

const filterOf = (over: Partial<TradeFilter>): TradeFilter => ({ ...EMPTY_FILTER, ...over });

describe('EMPTY_FILTER', () => {
  it('est inactif et ne compte aucune facette active', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(activeFacetCount(EMPTY_FILTER)).toBe(0);
  });

  it('est l’identité : applyFilter(list, EMPTY_FILTER) === list', () => {
    const list = [jt({ symbol: 'BTC' }), jt({ symbol: 'ETH', status: 'open', closedAt: null })];
    expect(applyFilter(list, EMPTY_FILTER, ctx)).toEqual(list);
  });
});

describe('isFilterActive / activeFacetCount', () => {
  it('la recherche seule active le filtre mais ne compte dans aucune facette', () => {
    const f = filterOf({ query: 'btc' });
    expect(isFilterActive(f)).toBe(true);
    expect(activeFacetCount(f)).toBe(0);
  });

  it('une recherche uniquement faite d’espaces n’active rien (comme après trim)', () => {
    expect(isFilterActive(filterOf({ query: '   ' }))).toBe(false);
  });

  it.each([
    ['sides', { sides: ['long'] as const }],
    ['outcomes', { outcomes: ['win'] as const }],
    ['setups', { setups: ['Cassure'] }],
    ['mistakes', { mistakes: ['Pas de stop'] }],
    ['tags', { tags: ['breakout'] }],
    ['accounts', { accounts: ['hl:a'] }],
  ])('chaque facette, seule, suffit à activer le filtre : %s', (_name, partial) => {
    expect(isFilterActive(filterOf(partial))).toBe(true);
  });

  it('compte les FACETTES actives, pas les valeurs sélectionnées', () => {
    const f = filterOf({ sides: ['long', 'short'], accounts: ['hl:a'] });
    expect(activeFacetCount(f)).toBe(2);
  });
});

describe('needsAnnotation', () => {
  it('clos sans journal : vrai', () => {
    expect(needsAnnotation(jt({ status: 'closed' }, null))).toBe(true);
  });

  it('clos avec un journal non vide : faux', () => {
    expect(needsAnnotation(jt({ status: 'closed' }, journalEntry({ thesis: 'x' })))).toBe(false);
  });

  it('ouvert (journal ou non) : jamais « à annoter »', () => {
    expect(needsAnnotation(jt({ status: 'open', closedAt: null }, null))).toBe(false);
  });
});

interface TripSeed {
  symbol: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed';
  accountId: string;
  hasJournal: boolean;
}

describe('applyFilter — propriétés générales', () => {
  const arbTrip: fc.Arbitrary<TripSeed> = fc.record({
    symbol: fc.constantFrom('BTC', 'ETH', 'SOL'),
    direction: fc.constantFrom<'long' | 'short'>('long', 'short'),
    status: fc.constantFrom<'open' | 'closed'>('open', 'closed'),
    accountId: fc.constantFrom('hl:a', 'hl:b'),
    hasJournal: fc.boolean(),
  });

  const tripFrom = (v: TripSeed): JournaledTrip =>
    jt(
      {
        symbol: v.symbol,
        direction: v.direction,
        status: v.status,
        accountId: v.accountId,
        closedAt: v.status === 'closed' ? '2026-08-01T10:00:00' : null,
      },
      v.hasJournal ? journalEntry({ thesis: 'une thèse' }) : null,
    );

  const arbFilter = fc.record({
    sides: fc.subarray<'long' | 'short'>(['long', 'short']),
    outcomes: fc.subarray<'win' | 'loss' | 'open' | 'unannotated'>([
      'win',
      'loss',
      'open',
      'unannotated',
    ]),
    accounts: fc.subarray(['hl:a', 'hl:b']),
  });

  it('résultat ⊆ entrée, ordre conservé', () => {
    fc.assert(
      fc.property(fc.array(arbTrip, { maxLength: 20 }), arbFilter, (raw, f) => {
        const list = raw.map(tripFrom);
        const filter = filterOf(f);
        const result = applyFilter(list, filter, ctx);
        // Sous-suite : chaque élément du résultat se retrouve dans `list`, dans le même ordre relatif.
        let cursor = 0;
        for (const r of result) {
          const idx = list.indexOf(r, cursor);
          expect(idx).toBeGreaterThanOrEqual(cursor);
          cursor = idx + 1;
        }
      }),
    );
  });

  it('idempotence : filtrer deux fois = filtrer une fois', () => {
    fc.assert(
      fc.property(fc.array(arbTrip, { maxLength: 20 }), arbFilter, (raw, f) => {
        const list = raw.map(tripFrom);
        const filter = filterOf(f);
        const once = applyFilter(list, filter, ctx);
        const twice = applyFilter(once, filter, ctx);
        expect(twice).toEqual(once);
      }),
    );
  });

  it('« unannotated » n’inclut jamais un trade ouvert', () => {
    fc.assert(
      fc.property(fc.array(arbTrip, { maxLength: 30 }), (raw) => {
        const list = raw.map(tripFrom);
        const result = applyFilter(list, filterOf({ outcomes: ['unannotated'] }), ctx);
        for (const r of result) expect(r.trip.status).toBe('closed');
      }),
    );
  });
});

describe('applyFilter — ET entre facettes, OU à l’intérieur d’une facette', () => {
  it('ET entre facettes : les deux doivent tenir', () => {
    const long = jt({ direction: 'long' }, journalEntry({ setup: 'Cassure' }));
    const longOther = jt({ direction: 'long' }, journalEntry({ setup: 'Retour sur moyenne' }));
    const short = jt({ direction: 'short' }, journalEntry({ setup: 'Cassure' }));
    const list = [long, longOther, short];

    const result = applyFilter(list, filterOf({ sides: ['long'], setups: ['Cassure'] }), ctx);
    expect(result).toEqual([long]);
  });

  it('OU à l’intérieur d’une facette (tags) : une seule valeur sélectionnée suffit', () => {
    const withA = jt({}, journalEntry({ tags: ['alpha'] }));
    const withB = jt({}, journalEntry({ tags: ['beta'] }));
    const withNeither = jt({}, journalEntry({ tags: ['gamma'] }));
    const list = [withA, withB, withNeither];

    const result = applyFilter(list, filterOf({ tags: ['alpha', 'beta'] }), ctx);
    expect(result).toEqual([withA, withB]);
  });

  /*
   * CONTRE-ÉPREUVE (décision n° 75, règle du dépôt) : dans `matchesFilter` (filter.ts), le test OU
   * de la facette tags — `filter.tags.some((k) => ownKeys.includes(k))` — a été changé en `.every(`
   * le temps de la vérifier. Le test ci-dessus est passé au ROUGE en nommant la faute :
   *   expected [ {…withA}, {…withB} ], received [ ] — aucun trade ne porte À LA FOIS "alpha" ET
   *   "beta", donc plus aucun ne matchait avec un ET. `.some(` a ensuite été restauré.
   */

  it('OU à l’intérieur d’une facette (erreurs)', () => {
    const withEntryLate = jt({}, journalEntry({ mistakes: ['Entrée trop tard'] }));
    const withNoStop = jt({}, journalEntry({ mistakes: ['Pas de stop'] }));
    const withNeither = jt({}, journalEntry({ mistakes: ['Taille trop grande'] }));
    const result = applyFilter(
      [withEntryLate, withNoStop, withNeither],
      filterOf({ mistakes: ['Entrée trop tard', 'Pas de stop'] }),
      ctx,
    );
    expect(result).toEqual([withEntryLate, withNoStop]);
  });

  it('facette vide = pas de contrainte', () => {
    const list = [jt({ direction: 'long' }), jt({ direction: 'short' })];
    expect(applyFilter(list, filterOf({ sides: [] }), ctx)).toEqual(list);
  });

  it('facette compte : exclut les trades d’un autre compte', () => {
    const accA = jt({ accountId: 'hl:a' });
    const accB = jt({ accountId: 'hl:b' });
    const result = applyFilter([accA, accB], filterOf({ accounts: ['hl:a'] }), ctx);
    expect(result).toEqual([accA]);
  });

  it('setup/erreurs/tags : un trade SANS journal ne casse pas (ni ne matche) le filtre', () => {
    const noJournal = jt({}, null);
    const withSetup = jt({}, journalEntry({ setup: 'Cassure' }));
    const withMistake = jt({}, journalEntry({ mistakes: ['Pas de stop'] }));
    const withTag = jt({}, journalEntry({ tags: ['breakout'] }));

    expect(() =>
      applyFilter([noJournal, withSetup], filterOf({ setups: ['Cassure'] }), ctx),
    ).not.toThrow();
    expect(applyFilter([noJournal, withSetup], filterOf({ setups: ['Cassure'] }), ctx)).toEqual([
      withSetup,
    ]);
    expect(
      applyFilter([noJournal, withMistake], filterOf({ mistakes: ['Pas de stop'] }), ctx),
    ).toEqual([withMistake]);
    expect(applyFilter([noJournal, withTag], filterOf({ tags: ['breakout'] }), ctx)).toEqual([
      withTag,
    ]);
  });
});

describe('applyFilter — recherche texte', () => {
  it('insensible à la casse et aux accents, sur le symbole', () => {
    const trip = jt({ symbol: 'BTC' });
    expect(applyFilter([trip], filterOf({ query: 'btc' }), ctx)).toEqual([trip]);
    expect(applyFilter([trip], filterOf({ query: 'BTC' }), ctx)).toEqual([trip]);
  });

  it('insensible aux accents, sur le texte du journal (thèse)', () => {
    const trip = jt({}, journalEntry({ thesis: 'Écrasement du support' }));
    expect(applyFilter([trip], filterOf({ query: 'ecrasement' }), ctx)).toEqual([trip]);
    expect(applyFilter([trip], filterOf({ query: 'ÉCRASEMENT' }), ctx)).toEqual([trip]);
  });

  it('porte sur le libellé du compte, fourni par le contexte', () => {
    const trip = jt({ accountId: 'hl:a' });
    expect(applyFilter([trip], filterOf({ query: 'principal' }), ctx)).toEqual([trip]);
    expect(applyFilter([trip], filterOf({ query: 'secondaire' }), ctx)).toEqual([]);
  });

  it('porte sur le setup, les erreurs et les tags du journal', () => {
    const trip = jt(
      {},
      journalEntry({ setup: 'Cassure', mistakes: ['Sortie émotionnelle'], tags: ['FOMO'] }),
    );
    expect(applyFilter([trip], filterOf({ query: 'cassure' }), ctx)).toEqual([trip]);
    expect(applyFilter([trip], filterOf({ query: 'émotionnelle' }), ctx)).toEqual([trip]);
    expect(applyFilter([trip], filterOf({ query: 'fomo' }), ctx)).toEqual([trip]);
  });

  it('vide (après trim) : ne filtre rien', () => {
    const list = [jt({ symbol: 'BTC' }), jt({ symbol: 'ETH' })];
    expect(applyFilter(list, filterOf({ query: '   ' }), ctx)).toEqual(list);
  });
});

describe('applyFilter — issue (win/loss/open/unannotated)', () => {
  it('win/loss reprennent le seuil de stats.ts, exclusivement sur les trades CLOS', () => {
    // Trade OUVERT avec des frais déjà comptés : netPnl négatif alors qu'il est encore ouvert.
    // Sans la garde explicite `status === 'closed'`, il matcherait à tort la facette « perdant ».
    const openWithFees = jt({ status: 'open', closedAt: null, netPnl: D('-5') });
    const win = jt({ status: 'closed', netPnl: D('10') });
    const loss = jt({ status: 'closed', netPnl: D('-10') });

    expect(applyFilter([openWithFees], filterOf({ outcomes: ['loss'] }), ctx)).toEqual([]);
    expect(applyFilter([openWithFees], filterOf({ outcomes: ['open'] }), ctx)).toEqual([
      openWithFees,
    ]);
    expect(applyFilter([win, loss], filterOf({ outcomes: ['win'] }), ctx)).toEqual([win]);
    expect(applyFilter([win, loss], filterOf({ outcomes: ['loss'] }), ctx)).toEqual([loss]);
  });

  it('symétrique : un trade OUVERT au P&L positif ne matche pas « gagnant »', () => {
    // Même piège que ci-dessus, côté gagnant : sans la garde `status === 'closed'` sur la branche
    // « win », un trade encore ouvert dont le netPnl est positif (P&L latent, pas réalisé) serait
    // compté à tort comme gagnant.
    const openInProfit = jt({ status: 'open', closedAt: null, netPnl: D('5') });
    expect(applyFilter([openInProfit], filterOf({ outcomes: ['win'] }), ctx)).toEqual([]);
    expect(applyFilter([openInProfit], filterOf({ outcomes: ['open'] }), ctx)).toEqual([
      openInProfit,
    ]);
  });

  it('OU à l’intérieur de la facette issue : gagnant OU ouvert, jamais perdant', () => {
    const win = jt({ status: 'closed', netPnl: D('10') });
    const loss = jt({ status: 'closed', netPnl: D('-10') });
    const open = jt({ status: 'open', closedAt: null });
    const result = applyFilter([win, loss, open], filterOf({ outcomes: ['win', 'open'] }), ctx);
    expect(result).toEqual([win, open]);
  });

  it('« open » exclut les trades clos', () => {
    const open = jt({ status: 'open', closedAt: null });
    const closed = jt({ status: 'closed' });
    expect(applyFilter([open, closed], filterOf({ outcomes: ['open'] }), ctx)).toEqual([open]);
  });

  it('unannotated = clos ET sans journal', () => {
    const closedNoJournal = jt({ status: 'closed' }, null);
    const closedWithJournal = jt({ status: 'closed' }, journalEntry({ thesis: 'x' }));
    const open = jt({ status: 'open', closedAt: null }, null);
    const result = applyFilter(
      [closedNoJournal, closedWithJournal, open],
      filterOf({ outcomes: ['unannotated'] }),
      ctx,
    );
    expect(result).toEqual([closedNoJournal]);
  });
});

describe('facetOptions', () => {
  it('compte les valeurs présentes par facette', () => {
    const list = [
      jt({ direction: 'long', accountId: 'hl:a' }),
      jt({ direction: 'long', accountId: 'hl:a' }),
      jt({ direction: 'short', accountId: 'hl:b' }),
    ];
    const options = facetOptions(list);
    expect(options.sides).toEqual([
      { value: 'long', count: 2 },
      { value: 'short', count: 1 },
    ]);
    expect(options.accounts.find((a) => a.value === 'hl:a')?.count).toBe(2);
  });

  it('trié par compte décroissant — ni alphabétique, ni l’ordre d’insertion', () => {
    // Deux pièges à la fois, comme pour `tagUsage` : `hl:aaa` (inséré EN PREMIER) ne doit pas
    // rester en tête (un tri absent laisserait l'ordre d'insertion), et `hl:zoo` (le plus
    // représenté) doit passer devant malgré son rang alphabétique DERNIER.
    const list = [
      jt({ accountId: 'hl:aaa' }),
      jt({ accountId: 'hl:mid' }),
      jt({ accountId: 'hl:zoo' }),
      jt({ accountId: 'hl:mid' }),
      jt({ accountId: 'hl:zoo' }),
      jt({ accountId: 'hl:zoo' }),
    ];
    const options = facetOptions(list);
    expect(options.accounts).toEqual([
      { value: 'hl:zoo', count: 3 },
      { value: 'hl:mid', count: 2 },
      { value: 'hl:aaa', count: 1 },
    ]);
  });

  it('les tags sont regroupés par clé normalisée (tagUsage)', () => {
    const list = [jt({}, journalEntry({ tags: ['btc'] })), jt({}, journalEntry({ tags: ['BTC'] }))];
    const options = facetOptions(list);
    expect(options.tags).toEqual([{ key: 'btc', label: 'btc', count: 2 }]);
  });

  it('outcomes : un même trade peut peupler plusieurs puces (clos, perdant, non annoté)', () => {
    const open = jt({ status: 'open', closedAt: null }, null);
    const win = jt({ status: 'closed', netPnl: D('10') }, journalEntry({ thesis: 'x' }));
    // Clos, perdant, ET sans journal : doit compter à la fois pour « loss » et « unannotated ».
    const lossUnannotated = jt({ status: 'closed', netPnl: D('-10') }, null);
    const options = facetOptions([open, win, lossUnannotated]);
    expect(new Set(options.outcomes.map((o) => o.value))).toEqual(
      new Set(['open', 'win', 'loss', 'unannotated']),
    );
    for (const o of options.outcomes) expect(o.count).toBe(1);
  });

  it('outcomes : comptes exacts, asymétriques — trahit une attribution win/loss croisée', () => {
    // Deux trades gagnants ANNOTÉS (jamais « unannotated »), un trade perdant ANNOTÉ, et un
    // troisième trade GAGNANT mais SANS journal (compte à la fois pour « win » et « unannotated »).
    // Avec un seul trade de chaque étiquette, une inversion win/loss donnerait le MÊME total par
    // accident (la valeur se déplace juste d'un trade à l'autre) : il faut des comptes différents
    // pour que l'inversion se voie sur le TOTAL.
    const win1 = jt({ status: 'closed', netPnl: D('10') }, journalEntry({ thesis: 'x' }));
    const win2 = jt({ status: 'closed', netPnl: D('20') }, journalEntry({ thesis: 'x' }));
    const loss1 = jt({ status: 'closed', netPnl: D('-5') }, journalEntry({ thesis: 'x' }));
    const winUnannotated = jt({ status: 'closed', netPnl: D('15') }, null);
    const open = jt({ status: 'open', closedAt: null }, null);
    const options = facetOptions([win1, win2, loss1, winUnannotated, open]);
    const countOf = (value: string): number | undefined =>
      options.outcomes.find((o) => o.value === value)?.count;
    expect(countOf('win')).toBe(3);
    expect(countOf('loss')).toBe(1);
    expect(countOf('unannotated')).toBe(1);
    expect(countOf('open')).toBe(1);
  });

  it('setups et erreurs : présents comptés, absents ignorés', () => {
    const withBoth = jt({}, journalEntry({ setup: 'Cassure', mistakes: ['Sortie émotionnelle'] }));
    const withoutJournal = jt({}, null);
    const options = facetOptions([withBoth, withoutJournal]);
    expect(options.setups).toEqual([{ value: 'Cassure', count: 1 }]);
    expect(options.mistakes).toEqual([{ value: 'Sortie émotionnelle', count: 1 }]);
  });

  it('liste vide : toutes les facettes sont vides', () => {
    const options = facetOptions([]);
    expect(options.sides).toEqual([]);
    expect(options.tags).toEqual([]);
  });
});

describe('summarizeFiltered', () => {
  it('stats == computeStats(tripsClosedIn(list, window), toDisplay) — égalité directe', () => {
    const list = [
      jt({ closedAt: '2026-08-05T10:00:00', netPnl: D('50') }),
      jt({ closedAt: '2026-08-20T10:00:00', netPnl: D('-20') }),
      jt({ status: 'open', closedAt: null }, null),
    ];
    const window = { from: '2026-08-01', to: '2026-08-31' };
    const summary = summarizeFiltered(list, window);
    const expected = computeStats(tripsClosedIn(list, window));
    expect(summary.stats).toEqual(expected);
  });

  it('open et needsAnnotation portent sur le SOUS-ENSEMBLE, pas sur la fenêtre', () => {
    // Une position ouverte n'a pas de jour de clôture : une fenêtre bornée l'exclut de `stats`,
    // mais `summarizeFiltered` doit quand même la compter dans `open`.
    const openTrade = jt({ status: 'open', closedAt: null }, null);
    const unannotated = jt({ closedAt: '2026-08-05T10:00:00' }, null);
    const annotated = jt({ closedAt: '2026-08-05T10:00:00' }, journalEntry({ thesis: 'x' }));
    const summary = summarizeFiltered([openTrade, unannotated, annotated], {
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(summary.open).toBe(1);
    expect(summary.needsAnnotation).toBe(1);
    expect(summary.stats.open).toBe(0); // exclu de la fenêtre bornée, comme tripsClosedIn le fait.
  });

  it('propriété : summarizeFiltered(list, window).stats égale toujours computeStats direct', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000, max: 1_000 }), { maxLength: 20 }),
        (values) => {
          const list = values.map((v, i) =>
            jt({
              closedAt: `2026-08-${String((i % 27) + 1).padStart(2, '0')}T10:00:00`,
              netPnl: D(String(v)),
            }),
          );
          const window = { from: '2026-08-10', to: '2026-08-20' };
          const summary = summarizeFiltered(list, window);
          const expected = computeStats(tripsClosedIn(list, window));
          expect(summary.stats).toEqual(expected);
        },
      ),
    );
  });
});
