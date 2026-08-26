import { describe, expect, it } from 'vitest';
import { D } from './money';
import {
  EXEMPTION_THRESHOLD,
  computeFrenchTax,
  dac8Summary,
  previewCession,
  rateFor,
  taxKindOf,
  type TaxInput,
} from './tax-fr';
import type { LedgerEvent, TradeEvent } from './types';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (at: string, out: string, into: string, valueEur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: out, qty: '1' },
  in: { asset: into, qty: '1' },
  valueEur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const buy = (at: string, asset: string, eur: string): TradeEvent => trade(at, 'eur', asset, eur);
const sell = (at: string, asset: string, eur: string): TradeEvent => trade(at, asset, 'eur', eur);

/** Valeur de CLÔTURE du portefeuille, par jour (le module y rajoute les produits du jour). */
const closing = (values: Record<string, string>) => (day: string) =>
  values[day] === undefined ? null : D(values[day]);

const ledger = (events: LedgerEvent[], over: Partial<TaxInput> = {}) =>
  computeFrenchTax({ events, ...over });

describe('classement fiscal des opérations', () => {
  it('n’impose que la sortie vers une monnaie ayant cours légal', () => {
    expect(taxKindOf(sell('2026-01-01T10:00:00', 'btc', '1000'))).toBe('cession');
    expect(taxKindOf(buy('2026-01-01T10:00:00', 'btc', '1000'))).toBe('acquisition');
    // Sursis : crypto contre crypto, stablecoins compris — c'est le cœur du régime français.
    expect(taxKindOf(trade('2026-01-01T10:00:00', 'btc', 'usdc', '1000'))).toBe('sursis');
    expect(taxKindOf(trade('2026-01-01T10:00:00', 'usdc', 'eth', '1000'))).toBe('sursis');
    expect(taxKindOf(trade('2026-01-01T10:00:00', 'usdc', 'eurcv', '1000'))).toBe('sursis');
    // Un stablecoin euro reste un actif numérique : sortir vers lui n'est pas une cession.
    expect(taxKindOf(trade('2026-01-01T10:00:00', 'btc', 'eurcv', '1000'))).toBe('sursis');
  });
});

describe('taux par millésime', () => {
  it('30 % jusqu’aux cessions 2024, 31,4 % ensuite', () => {
    expect(rateFor(2024).pfu).toBe('0.30');
    expect(rateFor(2025).pfu).toBe('0.314');
    expect(rateFor(2026).pfu).toBe('0.314');
  });
});

describe('computeFrenchTax — méthode globale de l’article 150 VH bis', () => {
  it('applique la formule et consomme le prix total d’acquisition au prorata', () => {
    // Achats : 10 000 € au total. Portefeuille valorisé 20 000 € avant la vente de 5 000 €.
    // Fraction imputée = 10 000 × 5 000 / 20 000 = 2 500 ; plus-value = 5 000 − 2 500 = 2 500.
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '6000'),
      buy('2026-02-01T10:00:00', 'eth', '4000'),
      sell('2026-06-01T10:00:00', 'btc', '5000'),
    ];
    // Clôture du jour = 15 000 (le vendu est parti) ; le module rajoute les 5 000 encaissés.
    const result = ledger(events, { closingValueAt: closing({ '2026-06-01': '15000' }) });
    expect(result.cessions).toHaveLength(1);
    const cession = result.cessions[0]!;
    expect(cession.globalValueEur).toBe('20000');
    expect(cession.acquisitionShareEur).toBe('2500');
    expect(cession.gainEur).toBe('2500');
    expect(cession.ptaAfter).toBe('7500');
    expect(result.ptaAfter).toBe('7500');
  });

  it('ignore les échanges en sursis : ils ne touchent ni au PTA ni au seuil', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      trade('2026-02-01T10:00:00', 'btc', 'usdc', '12000'),
      trade('2026-03-01T10:00:00', 'usdc', 'eth', '12000'),
    ];
    const result = ledger(events, { closingValueAt: closing({}) });
    expect(result.cessions).toHaveLength(0);
    expect(result.ptaAfter).toBe('10000');
    expect(result.years).toHaveLength(0);
  });

  it('enchaîne les cessions : chacune part du PTA laissé par la précédente', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
      sell('2026-09-01T10:00:00', 'btc', '3000'),
    ];
    const result = ledger(events, {
      closingValueAt: closing({ '2026-05-01': '15000', '2026-09-01': '9000' }),
    });
    const [first, second] = result.cessions;
    // 1re : global 20 000, imputé 2 500, PTA 7 500.
    expect(first!.gainEur).toBe('2500');
    expect(second!.ptaBefore).toBe('7500');
    // 2e : global 12 000, imputé 7 500 × 3 000 / 12 000 = 1 875 ; plus-value 1 125.
    expect(second!.acquisitionShareEur).toBe('1875');
    expect(second!.gainEur).toBe('1125');
    expect(result.ptaAfter).toBe('5625');
  });

  it('ne consomme jamais plus que le PTA restant', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '1000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
    ];
    // Valeur globale sous-évaluée : la fraction brute dépasserait le PTA.
    const result = ledger(events, { closingValueAt: closing({ '2026-05-01': '0' }) });
    expect(result.cessions[0]!.acquisitionShareEur).toBe('1000');
    expect(result.cessions[0]!.gainEur).toBe('4000');
    expect(result.ptaAfter).toBe('0');
  });

  it('avoue quand la valeur globale manque, sans inventer de plus-value', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
    ];
    const result = ledger(events);
    expect(result.unknownGlobalValue).toBe(1);
    expect(result.cessions[0]!.gainEur).toBeNull();
    // Le PTA ne bouge pas : mieux vaut un PTA trop élevé qu'une plus-value inventée.
    expect(result.ptaAfter).toBe('10000');
    expect(result.years[0]!.unknownGlobalValue).toBe(1);
  });

  it('préfère la valeur saisie à la main à la reconstitution', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
    ];
    const [, cession] = events;
    const result = ledger(events, {
      closingValueAt: closing({ '2026-05-01': '15000' }),
      annotations: { [cession!.id]: '40000' },
    });
    expect(result.cessions[0]!.globalValueEur).toBe('40000');
    // 10 000 × 5 000 / 40 000 = 1 250.
    expect(result.cessions[0]!.acquisitionShareEur).toBe('1250');
  });
});

describe('récapitulatif par année', () => {
  it('exonère sous 305 € de cessions, impose tout dès le premier euro au-delà', () => {
    const small = ledger(
      [buy('2026-01-01T10:00:00', 'btc', '100'), sell('2026-05-01T10:00:00', 'btc', '300')],
      {
        closingValueAt: closing({ '2026-05-01': '0' }),
      },
    );
    expect(small.years[0]!.exempt).toBe(true);
    expect(small.years[0]!.taxEur).toBe('0');
    expect(D(small.years[0]!.proceedsEur).lte(D(EXEMPTION_THRESHOLD))).toBe(true);

    const big = ledger(
      [buy('2026-01-01T10:00:00', 'btc', '100'), sell('2026-05-01T10:00:00', 'btc', '306')],
      {
        closingValueAt: closing({ '2026-05-01': '0' }),
      },
    );
    expect(big.years[0]!.exempt).toBe(false);
    // Plus-value = 306 − 100 = 206, imposée à 31,4 %.
    expect(big.years[0]!.netEur).toBe('206');
    expect(big.years[0]!.taxEur).toBe(D('206').times('0.314').toString());
  });

  it('impute les moins-values dans l’année, sans jamais les reporter', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      // Gagnante : global 20 000, imputé 2 500, +2 500.
      sell('2026-05-01T10:00:00', 'btc', '5000'),
      // Perdante : global 5 000, imputé 7 500 × 4 000 / 5 000 = 6 000, soit −2 000.
      sell('2026-06-01T10:00:00', 'btc', '4000'),
    ];
    const result = ledger(events, {
      closingValueAt: closing({ '2026-05-01': '15000', '2026-06-01': '1000' }),
    });
    const year = result.years[0]!;
    expect(year.gainsEur).toBe('2500');
    expect(year.lossesEur).toBe('2000');
    expect(year.netEur).toBe('500');
    expect(year.taxEur).toBe(D('500').times('0.314').toString());
  });

  it('n’impose rien sur une année nette perdante (la perte n’est pas reportable)', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-06-01T10:00:00', 'btc', '1000'),
    ];
    const result = ledger(events, { closingValueAt: closing({ '2026-06-01': '1000' }) });
    // Global 2 000 : imputé 10 000 × 1 000 / 2 000 = 5 000 → moins-value de 4 000.
    expect(result.years[0]!.netEur).toBe('-4000');
    expect(result.years[0]!.taxEur).toBe('0');
  });

  it('sépare les millésimes et leur applique leur propre taux', () => {
    const events = [
      buy('2023-01-01T10:00:00', 'btc', '1000'),
      sell('2024-06-01T10:00:00', 'btc', '2000'),
      buy('2025-01-01T10:00:00', 'btc', '1000'),
      sell('2026-06-01T10:00:00', 'btc', '2000'),
    ];
    const result = ledger(events, {
      closingValueAt: closing({ '2024-06-01': '2000', '2026-06-01': '2000' }),
    });
    expect(result.years.map((y) => y.year)).toEqual([2026, 2024]);
    expect(result.years.find((y) => y.year === 2024)!.rate).toBe('0.30');
    expect(result.years.find((y) => y.year === 2026)!.rate).toBe('0.314');
  });
});

describe('previewCession — l’aperçu avant de vendre', () => {
  const args = {
    ptaBefore: D('10000'),
    proceedsEur: D('5000'),
    globalValueEur: D('20000'),
    year: 2026,
  };

  it('donne la plus-value, l’impôt de l’année et le supplément dû à cette vente', () => {
    const preview = previewCession(args)!;
    expect(preview.gainEur).toBe('2500');
    expect(preview.ptaAfterEur).toBe('7500');
    expect(preview.exempt).toBe(false);
    expect(preview.taxEur).toBe(D('2500').times('0.314').toString());
    // Rien n'avait encore été vendu cette année : tout l'impôt vient de cette vente.
    expect(preview.taxDeltaEur).toBe(preview.taxEur);
  });

  it('tient compte des ventes déjà faites dans l’année (seuil et imputation)', () => {
    // Une moins-value de 1 000 € déjà constatée absorbe une partie de la plus-value.
    const preview = previewCession({
      ...args,
      yearProceedsEur: D('4000'),
      yearNetEur: D('-1000'),
    })!;
    expect(preview.yearNetEur).toBe('1500');
    expect(preview.taxEur).toBe(D('1500').times('0.314').toString());
    // Sans cette vente, l'année était perdante donc non imposée : tout le supplément lui revient.
    expect(preview.taxDeltaEur).toBe(preview.taxEur);
  });

  it('reste exonéré tant que le total des cessions de l’année ne dépasse pas 305 €', () => {
    const preview = previewCession({ ...args, proceedsEur: D('300') })!;
    expect(preview.exempt).toBe(true);
    expect(preview.taxEur).toBe('0');
    expect(preview.taxDeltaEur).toBe('0');
    // Un euro de plus fait basculer toute l'année dans l'impôt.
    const over = previewCession({ ...args, proceedsEur: D('306') })!;
    expect(over.exempt).toBe(false);
    expect(D(over.taxEur).gt('0')).toBe(true);
  });

  it('refuse de deviner sans valeur globale ni produit', () => {
    expect(previewCession({ ...args, globalValueEur: D('0') })).toBeNull();
    expect(previewCession({ ...args, proceedsEur: D('0') })).toBeNull();
  });
});

describe('dac8Summary — contrôler ce que la plateforme déclarera', () => {
  const events = [
    buy('2026-01-01T10:00:00', 'btc', '10000'),
    buy('2026-02-01T10:00:00', 'eth', '4000'),
    sell('2026-05-01T10:00:00', 'btc', '5000'),
    sell('2026-06-01T10:00:00', 'btc', '3000'),
    // Sursis : jamais déclaré comme cession, ni comme acquisition en euros.
    trade('2026-07-01T10:00:00', 'btc', 'usdc', '2000'),
    // Une autre année : hors périmètre.
    sell('2025-05-01T10:00:00', 'btc', '9999'),
  ];

  it('agrège par actif les cessions et les acquisitions de l’année', () => {
    const summary = dac8Summary(events, 2026);
    const btc = summary.lines.find((l) => l.asset === 'btc')!;
    expect(btc.disposals).toBe(2);
    expect(btc.grossProceedsEur).toBe('8000');
    // Deux ventes d'une unité chacune dans les fixtures.
    expect(btc.units).toBe('2');
    expect(btc.acquisitions).toBe(1);
    expect(btc.acquisitionsEur).toBe('10000');
    const eth = summary.lines.find((l) => l.asset === 'eth')!;
    expect(eth.disposals).toBe(0);
    expect(eth.acquisitionsEur).toBe('4000');
    expect(summary.totalProceedsEur).toBe('8000');
    expect(summary.totalAcquisitionsEur).toBe('14000');
  });

  it('classe du plus gros produit de cession au plus petit', () => {
    expect(dac8Summary(events, 2026).lines[0]!.asset).toBe('btc');
  });

  it('ignore les autres années et rend un récapitulatif vide sans opération', () => {
    expect(dac8Summary(events, 2024).lines).toEqual([]);
    expect(dac8Summary(events, 2024).totalProceedsEur).toBe('0');
    expect(dac8Summary(events, 2025).lines[0]!.grossProceedsEur).toBe('9999');
  });
});
