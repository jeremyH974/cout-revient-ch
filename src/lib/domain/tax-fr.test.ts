import { describe, expect, it } from 'vitest';
import { D } from './money';
import {
  EXEMPTION_THRESHOLD,
  computeFrenchTax,
  dac8Summary,
  declarableYears,
  declarationYear,
  previewCession,
  rateFor,
  TAX_RATES,
  taxKindOf,
  touchesEquity,
  type TaxInput,
} from './tax-fr';
import type {
  DepositEvent,
  LedgerEvent,
  OpeningBalanceEvent,
  RewardEvent,
  TradeEvent,
  WithdrawalEvent,
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

const reward = (at: string, asset: string, fairValueEur: string | null): RewardEvent => ({
  ...base(),
  kind: 'reward',
  at,
  in: { asset, qty: '1' },
  fairValueEur,
});
const deposit = (at: string, asset: string, costEur: string | null): DepositEvent => ({
  ...base(),
  kind: 'deposit',
  at,
  in: { asset, qty: '1' },
  costEur,
});
const withdrawal = (at: string, asset: string, proceedsEur: string | null): WithdrawalEvent => ({
  ...base(),
  kind: 'withdrawal',
  at,
  out: { asset, qty: '1' },
  proceedsEur,
});
const opening = (at: string, asset: string, costEur: string): OpeningBalanceEvent => ({
  ...base(),
  kind: 'opening-balance',
  at,
  in: { asset, qty: '1' },
  costEur,
});

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
    // Deux monnaies ayant cours légal : un change euro → dollar n'entre ni ne sort de l'assiette.
    // Le classer « cession » y ferait entrer le montant changé, donc le seuil de 305 € aussi.
    expect(taxKindOf(trade('2026-01-01T10:00:00', 'eur', 'usd', '1000'))).toBe('ignored');
  });

  /**
   * Chaque nature porte son régime, et il n'y a pas de fourre-tout : une nature mal classée
   * déplace un montant d'une réserve à l'autre (« le PTA est sous-estimé », « sortie non classée »)
   * ou l'ajoute au prix total d'acquisition, sans qu'aucun total ne détonne.
   */
  it('donne son régime à chacune des dix natures d’événement du grand livre', () => {
    const at = '2026-03-01T10:00:00';
    expect(taxKindOf(reward(at, 'btc', '500'))).toBe('reward');
    expect(taxKindOf(deposit(at, 'btc', '500'))).toBe('external-in');
    expect(taxKindOf(withdrawal(at, 'btc', null))).toBe('external-out');
    // Le solde d'ouverture est l'historique manquant : son coût entre au PTA comme un achat.
    expect(taxKindOf(opening(at, 'btc', '500'))).toBe('acquisition');

    // Sans effet sur le PTA : coût reporté, action de société, frais de compte, ligne à qualifier.
    const migration: LedgerEvent = {
      ...base(),
      kind: 'migration',
      at,
      out: { asset: 'btc', qty: '1' },
      in: { asset: 'wbtc', qty: '1' },
      fairValueOutEur: null,
      fairValueInEur: null,
    };
    const split: LedgerEvent = { ...base(), kind: 'split', at, asset: 'btc', ratio: '2' };
    const fee: LedgerEvent = { ...base(), kind: 'fee', at, amountEur: '9.9', label: 'Abonnement' };
    const unqualified: LedgerEvent = {
      ...base(),
      kind: 'unqualified',
      at,
      rawType: 'Echange Delisting',
      legs: [],
      reason: 'inconnu',
    };
    // Un revenu en espèces relève des revenus de capitaux mobiliers, jamais d'ici (décision n° 132).
    const income: LedgerEvent = {
      ...base(),
      kind: 'income',
      at,
      asset: null,
      grossEur: '500',
      withheldEur: '0',
      nature: 'interest',
      label: 'Intérêts',
    };
    for (const event of [migration, split, fee, unqualified, income])
      expect(taxKindOf(event), event.kind).toBe('ignored');
  });

  it('refuse une nature inconnue au lieu de la ranger silencieusement en « ignoré »', () => {
    // Décision n° 129 : un type d'événement neuf doit faire une erreur bruyante, qui le NOMME.
    // Rendu « ignoré », il serait fiscalement invisible et le chiffre serait simplement un peu faux.
    const neuf = { ...base(), at: '2026-03-01T10:00:00', kind: 'staking-lock' };
    expect(() => taxKindOf(neuf as unknown as LedgerEvent)).toThrow(/staking-lock/);
  });

  it('écarte une valeur mobilière quelle que soit la jambe qui la porte', () => {
    const at = '2026-03-01T10:00:00';
    expect(touchesEquity(sell(at, 'eq:aapl', '9000'))).toBe(true);
    expect(touchesEquity(buy(at, 'eq:aapl', '9000'))).toBe(true);
    // Troisième jambe : un revenu rattaché à une ligne de titres (dividende) n'a ni `out` ni `in`.
    const dividende: LedgerEvent = {
      ...base(),
      kind: 'income',
      at,
      asset: 'eq:aapl',
      grossEur: '120',
      withheldEur: '18',
      nature: 'dividend',
      label: 'Dividende',
    };
    expect(touchesEquity(dividende)).toBe(true);
    // `asset` nul = revenu au compte : rien à écarter, et surtout pas tout le grand livre.
    expect(touchesEquity({ ...dividende, asset: null })).toBe(false);
    expect(touchesEquity(sell(at, 'btc', '9000'))).toBe(false);
  });
});

describe('taux par millésime', () => {
  it('30 % jusqu’aux cessions 2024, 31,4 % ensuite', () => {
    expect(rateFor(2024).pfu).toBe('0.30');
    expect(rateFor(2025).pfu).toBe('0.314');
    expect(rateFor(2026).pfu).toBe('0.314');
  });

  /**
   * La ventilation n'est pas décorative : l'option pour le barème ne remplace que la part
   * **impôt sur le revenu**, les prélèvements sociaux restant dus à l'identique. Une ligne dont
   * les deux parts ne feraient pas le total ferait chiffrer un arbitrage faux, sans rien casser
   * d'autre (décision n° 150).
   */
  it('ventile chaque taux en impôt sur le revenu et prélèvements sociaux, dont la somme fait le total', () => {
    expect(TAX_RATES.length).toBeGreaterThan(1);
    for (const rate of TAX_RATES) {
      const sum = D(rate.incomeTax).plus(D(rate.social));
      expect(sum.toString(), `${rate.label} — ${rate.incomeTax} + ${rate.social}`).toBe(
        D(rate.pfu).toString(),
      );
    }
  });

  /**
   * Le libellé est la seule phrase que l'utilisateur lit SOUS le montant d'impôt estimé : c'est
   * elle qui lui dit de quoi ce taux est fait. Vidée ou recopiée d'un millésime sur l'autre, le
   * montant reste juste et son explication devient fausse — personne ne le verrait.
   */
  it('écrit chaque taux en toutes lettres, et pas le même d’un millésime à l’autre', () => {
    expect(rateFor(2024).label).toBe('30 % (12,8 % + 17,2 %)');
    expect(rateFor(2025).label).toBe('31,4 % (12,8 % + 18,6 %)');
  });

  it('garde la part impôt sur le revenu à 12,8 %, seule la CSG ayant bougé', () => {
    expect(rateFor(2024).incomeTax).toBe('0.128');
    expect(rateFor(2025).incomeTax).toBe('0.128');
    expect(rateFor(2024).social).toBe('0.172');
    expect(rateFor(2025).social).toBe('0.186');
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

  it('retombe sur la reconstitution quand l’annotation a été effacée', () => {
    // Une annotation persistée vaut `portfolioValueEur: null` dès que l'utilisateur vide le champ
    // (`storage/schema.ts`). La clé existe alors SANS valeur : la traiter comme une saisie ferait
    // perdre la valeur reconstituée — ou lever une erreur au milieu du rapport.
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
    ];
    const [, cession] = events;
    const result = ledger(events, {
      closingValueAt: closing({ '2026-05-01': '15000' }),
      annotations: { [cession!.id]: null },
    });
    expect(result.cessions[0]!.globalValueEur).toBe('20000');
    expect(result.cessions[0]!.acquisitionShareEur).toBe('2500');
  });

  it('rend les mêmes chiffres quel que soit l’ordre des lignes reçues', () => {
    // Le module annonce accepter le grand livre « dans n'importe quel ordre », et le PTA se
    // consomme cession après cession : rejoué à l'envers, le même relevé donnerait d'autres
    // plus-values sans qu'aucun total ne détonne. Ce sont les chiffres du rejeu chronologique
    // (cf. « enchaîne les cessions ») qui sont attendus ici, sur une entrée désordonnée.
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
      sell('2026-09-01T10:00:00', 'btc', '3000'),
    ];
    const result = ledger([events[2]!, events[0]!, events[1]!], {
      closingValueAt: closing({ '2026-05-01': '15000', '2026-09-01': '9000' }),
    });
    expect(result.cessions.map((c) => c.at)).toEqual([
      '2026-05-01T10:00:00',
      '2026-09-01T10:00:00',
    ]);
    expect(result.cessions[0]!.gainEur).toBe('2500');
    expect(result.cessions[1]!.acquisitionShareEur).toBe('1875');
    expect(result.cessions[1]!.gainEur).toBe('1125');
    expect(result.ptaAfter).toBe('5625');
  });

  it('laisse deux opérations de la même seconde dans l’ordre du relevé', () => {
    // À la seconde près, le module n'a rien pour les départager : il garde l'ordre reçu. Les
    // réordonner ferait précéder la vente par un achat qu'elle n'avait pas encore, et lui prêterait
    // un prix d'acquisition — ici 2 500 € imputés au lieu de zéro.
    const events = [
      sell('2026-01-01T10:00:00', 'btc', '5000'),
      buy('2026-01-01T10:00:00', 'btc', '10000'),
    ];
    const result = ledger(events, { closingValueAt: closing({ '2026-01-01': '15000' }) });
    expect(result.cessions[0]!.ptaBefore).toBe('0');
    expect(result.cessions[0]!.acquisitionShareEur).toBe('0');
    expect(result.cessions[0]!.gainEur).toBe('5000');
    expect(result.ptaAfter).toBe('10000');
  });

  it('ne rajoute à la clôture du jour que ce qui est SORTI du portefeuille ce jour-là', () => {
    // La valeur d'avant la cession se reconstitue en rendant à la clôture les produits encaissés.
    // Y verser aussi un achat du même jour gonflerait le dénominateur et minorerait la part
    // d'acquisition imputée, donc majorerait la plus-value — d'un montant que rien n'affiche.
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      buy('2026-06-01T09:00:00', 'eth', '2000'),
      sell('2026-06-01T10:00:00', 'btc', '5000'),
    ];
    const result = ledger(events, { closingValueAt: closing({ '2026-06-01': '15000' }) });
    const cession = result.cessions[0]!;
    expect(cession.globalValueEur).toBe('20000');
    // 12 000 × 5 000 / 20 000 = 3 000 (et non 12 000 × 5 000 / 22 000 = 2 727,27…).
    expect(cession.acquisitionShareEur).toBe('3000');
    expect(cession.gainEur).toBe('2000');
  });

  it('ne compte comme non chiffrées que les cessions qui le sont vraiment', () => {
    // Une année mêle presque toujours des jours couverts par l'historique de prix et des jours
    // qui ne le sont pas. Compter toutes les cessions ferait annoncer une année entièrement
    // approximative alors que la plus-value affichée est, elle, exacte.
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '10000'),
      sell('2026-05-01T10:00:00', 'btc', '5000'),
      sell('2026-09-01T10:00:00', 'btc', '3000'),
    ];
    const result = ledger(events, { closingValueAt: closing({ '2026-05-01': '15000' }) });
    expect(result.unknownGlobalValue).toBe(1);
    expect(result.cessions[0]!.gainEur).toBe('2500');
    expect(result.cessions[1]!.gainEur).toBeNull();
    const year = result.years[0]!;
    expect(year.cessionCount).toBe(2);
    expect(year.unknownGlobalValue).toBe(1);
    expect(year.gainsEur).toBe('2500');
  });
});

describe('les réserves que le rapport affiche sous l’estimation', () => {
  // Ces trois compteurs ne changent aucun montant : ils disent à l'utilisateur POURQUOI le
  // montant peut être faux (`export/report-model.ts`). Un compteur muet est une réserve perdue.

  it('fait entrer au PTA le coût d’un solde d’ouverture et d’un dépôt renseigné', () => {
    const result = ledger([
      opening('2026-01-01T10:00:00', 'btc', '3000'),
      deposit('2026-02-01T10:00:00', 'eth', '2000'),
    ]);
    expect(result.ptaAfter).toBe('5000');
    // Leur coût est connu : aucune réserve à signaler, et surtout pas sur l'achat en euros.
    expect(result.externalInflows).toBe(0);
  });

  it('signale l’entrée venue de l’extérieur dont le coût est inconnu, sans rien inventer', () => {
    const result = ledger([
      buy('2026-01-01T10:00:00', 'btc', '1000'),
      deposit('2026-02-01T10:00:00', 'eth', null),
    ]);
    // Rien n'est ajouté au PTA : un coût inventé minorerait la plus-value de toutes les cessions.
    expect(result.ptaAfter).toBe('1000');
    expect(result.externalInflows).toBe(1);
  });

  it('compte les récompenses et les sorties, qui n’entrent ni ne sortent du PTA', () => {
    const result = ledger([
      buy('2026-01-01T10:00:00', 'btc', '1000'),
      // Décision n° 9 : une récompense entre à coût nul, sa juste valeur n'est pas un prix payé.
      reward('2026-02-01T10:00:00', 'btc', '500'),
      withdrawal('2026-03-01T10:00:00', 'btc', null),
    ]);
    expect(result.ptaAfter).toBe('1000');
    expect(result.rewards).toBe(1);
    expect(result.externalOutflows).toBe(1);
    expect(result.externalInflows).toBe(0);
    expect(result.cessions).toEqual([]);
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
    // Chaque année emporte AUSSI son libellé : servir celui de 2026 à 2024 expliquerait le montant
    // par un taux que l'année n'a jamais connu.
    expect(result.years.find((y) => y.year === 2024)!.rateLabel).toBe('30 % (12,8 % + 17,2 %)');
    expect(result.years.find((y) => y.year === 2026)!.rateLabel).toBe('31,4 % (12,8 % + 18,6 %)');
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
    // L'ETH est le premier actif rencontré, et celui qui ne sera jamais cédé : c'est donc
    // l'ordre du grand livre, et non le produit de cession, qui le placerait en tête sans tri.
    buy('2026-02-01T10:00:00', 'eth', '4000'),
    buy('2026-01-01T10:00:00', 'btc', '10000'),
    sell('2026-05-01T10:00:00', 'btc', '5000'),
    sell('2026-06-01T10:00:00', 'btc', '3000'),
    // Sursis : jamais déclaré comme cession, ni comme acquisition en euros.
    trade('2026-07-01T10:00:00', 'btc', 'usdc', '2000'),
    // Une autre année : hors périmètre.
    sell('2025-05-01T10:00:00', 'btc', '9999'),
    // Hors opérations de plateforme : DAC8 fait remonter des transactions, pas de l'historique
    // reconstitué ni des mouvements de portefeuille.
    opening('2026-01-02T10:00:00', 'btc', '7000'),
    deposit('2026-04-01T10:00:00', 'btc', '200'),
    reward('2026-04-02T10:00:00', 'btc', '100'),
    withdrawal('2026-08-01T10:00:00', 'btc', null),
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

  it('ne fait remonter que des opérations, jamais un solde d’ouverture ni un dépôt', () => {
    // Le solde d'ouverture est une reconstitution maison de l'historique manquant, et un dépôt
    // vient d'ailleurs : les déclarer ferait attendre de la plateforme 7 200 € d'acquisitions
    // qu'elle ne déclarera jamais, et la comparaison ne servirait plus à rien.
    const summary = dac8Summary(events, 2026);
    expect(summary.lines.find((l) => l.asset === 'btc')!.acquisitions).toBe(1);
    expect(summary.totalAcquisitionsEur).toBe('14000');
  });

  it('classe du plus gros produit de cession au plus petit', () => {
    // Le récapitulatif se lit de haut en bas : l'actif le plus lourd doit ouvrir la liste, même
    // s'il n'est pas le premier du grand livre.
    expect(dac8Summary(events, 2026).lines.map((l) => l.asset)).toEqual(['btc', 'eth']);
  });

  it('ignore les autres années et rend un récapitulatif vide sans opération', () => {
    expect(dac8Summary(events, 2024).lines).toEqual([]);
    expect(dac8Summary(events, 2024).totalProceedsEur).toBe('0');
    expect(dac8Summary(events, 2025).lines[0]!.grossProceedsEur).toBe('9999');
  });
});

describe('les valeurs mobilières ne sont pas des actifs numériques', () => {
  // Décision n° 119. L'assiette du 150 VH bis est le portefeuille entier ; celle du 150-0 D est la
  // ligne. Mélanger les deux ne donne pas une approximation, mais un chiffre faux — et il
  // s'affichait sur trois écrans et dans le PDF, présenté comme une estimation fiscale.

  it('l’achat d’une action ne gonfle pas le prix total d’acquisition', () => {
    const withEquity = ledger([
      buy('2026-01-02T10:00:00', 'btc', '1000'),
      buy('2026-01-03T10:00:00', 'eq:aapl', '5000'),
    ]);
    const cryptoOnly = ledger([buy('2026-01-02T10:00:00', 'btc', '1000')]);
    expect(withEquity.ptaAfter).toBe(cryptoOnly.ptaAfter);
    expect(withEquity.ptaAfter).toBe('1000');
  });

  it('la vente d’une action n’est pas une cession de l’assiette crypto', () => {
    const l = ledger(
      [
        buy('2026-01-02T10:00:00', 'btc', '1000'),
        buy('2026-01-03T10:00:00', 'eq:aapl', '5000'),
        sell('2026-06-01T10:00:00', 'eq:aapl', '9000'),
      ],
      { closingValueAt: closing({ '2026-06-01': '2000' }) },
    );
    expect(l.cessions).toEqual([]);
  });

  it('un échange action → crypto n’est pas un sursis d’imposition', () => {
    // Le code le classait « sursis » (deux actifs non-fiat), ce qui est juridiquement faux : une
    // cession de titre est un fait générateur. Hors de cette assiette, il n'y est plus du tout.
    const l = ledger([
      buy('2026-01-02T10:00:00', 'eq:aapl', '5000'),
      trade('2026-06-01T10:00:00', 'eq:aapl', 'btc', '9000'),
    ]);
    expect(l.ptaAfter).toBe('0');
    expect(l.cessions).toEqual([]);
  });

  it('la crypto du même grand livre reste imposée normalement', () => {
    // Le filtre écarte les titres, il ne doit rien retirer d'autre.
    const l = ledger(
      [
        buy('2026-01-02T10:00:00', 'btc', '1000'),
        buy('2026-01-03T10:00:00', 'eq:aapl', '5000'),
        sell('2026-06-01T10:00:00', 'btc', '3000'),
      ],
      { closingValueAt: closing({ '2026-06-01': '0' }) },
    );
    expect(l.cessions).toHaveLength(1);
  });
});

describe('quelle année le rapport décrit', () => {
  it('la déclaration de printemps porte sur l’année précédente', () => {
    expect(declarationYear('2027-05-15')).toBe(2026);
    expect(declarationYear('2027-01-01')).toBe(2026);
  });

  it('bascule le 1er juillet, pas avant', () => {
    expect(declarationYear('2027-06-30')).toBe(2026);
    expect(declarationYear('2027-07-01')).toBe(2027);
    expect(declarationYear('2027-12-31')).toBe(2027);
  });

  it('propose l’année déclarée et l’année courante même sans la moindre opération', () => {
    expect(declarableYears([], '2027-05-15')).toEqual([2027, 2026]);
  });

  it('ajoute les années du grand livre, de la plus récente à la plus ancienne', () => {
    const events = [
      buy('2024-03-01T10:00:00', 'btc', '100'),
      sell('2025-04-01T10:00:00', 'btc', '200'),
    ];
    expect(declarableYears(events, '2027-05-15')).toEqual([2027, 2026, 2025, 2024]);
  });

  it('n’offre jamais une année postérieure à aujourd’hui', () => {
    // Une date future dans un relevé est une anomalie d'import, pas une année déclarable.
    const events = [buy('2029-03-01T10:00:00', 'btc', '100')];
    expect(declarableYears(events, '2027-05-15')).toEqual([2027, 2026]);
  });

  it('rend une liste strictement décroissante et sans doublon', () => {
    const events = [
      buy('2026-01-01T10:00:00', 'btc', '100'),
      buy('2026-02-01T10:00:00', 'btc', '100'),
      sell('2027-02-01T10:00:00', 'btc', '150'),
    ];
    const years = declarableYears(events, '2027-05-15');
    expect(new Set(years).size).toBe(years.length);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });
});
