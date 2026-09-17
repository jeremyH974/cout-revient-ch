/**
 * Fiscalité française des actifs numériques — **estimation**, jamais un calcul officiel
 * (décision n° 43). Article 150 VH bis du CGI, méthode dite « globale » :
 *
 *   plus-value = prix de cession − prix total d'acquisition × (prix de cession ÷ valeur globale
 *                                                              du portefeuille au jour de la cession)
 *
 * Deux conséquences qui commandent tout le module :
 *
 * 1. **Le prix total d'acquisition (PTA) est celui du PORTEFEUILLE ENTIER, pas d'un actif.** Il
 *    n'a donc rien à voir avec le PRU par actif que calcule le reste de l'app (décision n° 10) :
 *    il monte à chaque achat en euros et se consomme, cession après cession, au prorata de ce qui
 *    est vendu. Il faut REJOUER l'historique dans l'ordre pour connaître le PTA d'aujourd'hui.
 * 2. **Seule la sortie vers une monnaie ayant cours légal est imposable.** Les échanges entre
 *    actifs numériques — stablecoins compris — bénéficient du sursis : ils ne déclenchent rien et
 *    ne touchent pas au PTA. L'achat de biens ou de services en crypto est imposable lui aussi,
 *    mais un export ne permet pas de le distinguer d'un retrait : c'est signalé, pas deviné.
 *
 * 3. **Les valeurs mobilières n'entrent pas dans cette assiette.** Une action relève de l'article
 *    150-0 D — prix moyen pondéré **par ligne**, et toute cession est un fait générateur, y compris
 *    contre un autre titre. Les deux méthodes sont mathématiquement incompatibles : mélanger les
 *    deux ne donne pas une approximation, mais un chiffre faux. Le filtre est posé **ici**, à
 *    l'entrée du module, et non chez l'appelant : c'est ce module qui est le régime des actifs
 *    numériques, et aucun appelant ne peut donc l'oublier (décision n° 119).
 *
 * Module pur : `Big` et chaînes décimales, aucun arrondi d'affichage, aucune horloge (l'année
 * d'une cession se lit dans sa date). Le texte français vit dans la couche d'affichage.
 */
import { isEquityCode, isFiat } from './assets';
import { D, ZERO, toDecimalString, type Big, type DecimalString } from './money';
import type { AssetCode, EventId, LedgerEvent, NaiveDateTime } from './types';

/**
 * Prélèvement forfaitaire unique par millésime de cession. La CSG patrimoine étant passée à
 * 10,6 % (LFSS 2026), les prélèvements sociaux valent 18,6 % et le PFU 31,4 % ; il valait 30 %
 * auparavant. Table ordonnée : un nouveau taux = une ligne de plus, rien à réécrire.
 */
export interface TaxRate {
  /** Première année de cession à laquelle le taux s'applique. */
  from: number;
  /** Taux global (impôt sur le revenu + prélèvements sociaux). */
  pfu: DecimalString;
  /**
   * Part **impôt sur le revenu** — la seule que l'option pour le barème remplace (décision
   * n° 150). Elle n'existait ici que dans le `label`, en toutes lettres : comparer le forfait au
   * barème aurait demandé de LIRE un libellé pour en extraire un taux, ce que ce dépôt
   * s'interdit. `RCM_RATES`, dans `lending/`, portait déjà cette ventilation.
   */
  incomeTax: DecimalString;
  /** Part **prélèvements sociaux** : identique sous forfait et sous barème, elle ne s'arbitre pas. */
  social: DecimalString;
  label: string;
  /**
   * Identifiant de l'entrée de veille qui porte le texte de loi (décision n° 80).
   *
   * Un **lien**, pas une copie : la citation, l'URL Légifrance et la date de relecture vivent dans
   * `src/lib/watch/entries.ts`, et deux tables portant la même citation divergeraient au premier
   * amendement. C'est une chaîne nue plutôt qu'un import, pour que le domaine reste pur — la couche
   * `watch` dépend déjà de `domain/date`, l'inverse renverserait les couches. La résolution se fait
   * à l'affichage, et `tax-source.test.ts` croise les deux tables.
   *
   * Absent sur les taux d'archive : la veille suit ce qui bouge, pas ce qui est clos.
   */
  sourceId?: string;
}

export const TAX_RATES: readonly TaxRate[] = [
  { from: 0, pfu: '0.30', incomeTax: '0.128', social: '0.172', label: '30 % (12,8 % + 17,2 %)' },
  {
    from: 2025,
    pfu: '0.314',
    incomeTax: '0.128',
    social: '0.186',
    label: '31,4 % (12,8 % + 18,6 %)',
    sourceId: 'pfu-31_4',
  },
];

/** Taux applicable aux cessions d'une année (le plus récent qui la couvre). */
export function rateFor(year: number): TaxRate {
  let found = TAX_RATES[0]!;
  for (const rate of TAX_RATES) if (year >= rate.from) found = rate;
  return found;
}

/**
 * Mois à partir duquel la déclaration « en cours » bascule sur l'année civile courante. La
 * campagne déclarative française se tient au printemps et porte sur l'année précédente : jusqu'au
 * 30 juin, l'année qu'on remplit est donc l'année passée ; à partir du 1er juillet, plus aucune
 * déclaration n'est ouverte et la seule année encore à venir est l'année courante.
 */
const DECLARATION_TURNS_TO_CURRENT_YEAR_IN_MONTH = 7;

/**
 * Année sur laquelle porte la déclaration qu'on remplirait aujourd'hui.
 *
 * C'est un **défaut d'affichage**, pas une déduction sur des données : l'année retenue est
 * toujours nommée à l'écran et l'utilisateur en change d'un geste. La distinction compte — ce
 * projet ne devine jamais une donnée (décisions n° 124, 137, 139), mais proposer une valeur
 * visible et modifiable n'est pas deviner.
 *
 * `today` est fourni par l'appelant : ce module n'a pas d'horloge (voir l'en-tête).
 */
export function declarationYear(today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month < DECLARATION_TURNS_TO_CURRENT_YEAR_IN_MONTH ? year - 1 : year;
}

/**
 * Années qu'un rapport peut décrire, de la plus récente à la plus ancienne : celles où le grand
 * livre porte quelque chose, plus l'année de la déclaration en cours et l'année civile courante.
 *
 * Une année sans la moindre opération reste une réponse utile — « rien à déclarer pour 2025 » est
 * une information, pas un trou. En revanche rien au-delà de l'année courante : une date future
 * dans un relevé est une anomalie d'import, pas une année déclarable.
 */
export function declarableYears(events: readonly LedgerEvent[], today: string): number[] {
  const currentYear = Number(today.slice(0, 4));
  const years = new Set<number>([declarationYear(today), currentYear]);
  for (const event of events) {
    const year = yearOf(event.at);
    if (year <= currentYear) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * Seuil d'exonération : si la SOMME DES PRIX DE CESSION de l'année (hors échanges en sursis) ne
 * dépasse pas 305 €, la plus-value n'est pas imposable. Au-delà, tout est imposable dès le
 * premier euro — ce n'est pas un abattement.
 */
export const EXEMPTION_THRESHOLD: DecimalString = '305';

/** Entrée de veille qui porte le texte du seuil ci-dessus (même principe que `TaxRate.sourceId`). */
export const EXEMPTION_THRESHOLD_SOURCE_ID = 'seuil-305';

/** Nature fiscale d'un événement du grand livre, telle que ce module la lit. */
export type TaxEventKind =
  'acquisition' | 'cession' | 'sursis' | 'reward' | 'external-in' | 'external-out' | 'ignored';

export interface TaxCession {
  eventId: EventId;
  at: NaiveDateTime;
  year: number;
  /**
   * Prix de cession **net des frais** — la ligne 218 de l'annexe 2086 (sans soulte : 218 = 215).
   * C'est lui dont on retranche la fraction du prix d'acquisition, et lui que le seuil de 305 €
   * additionne (ligne 51 = Σ l. 218).
   */
  proceedsEur: DecimalString;
  /**
   * Frais de cession **effectivement supportés** — la ligne 214 : frais bruts moins la remise.
   *
   * Ils ne servent pas qu'à l'affichage : le **rapport** de la formule prend le prix AVANT frais
   * (ligne 217), la soustraction le prix APRÈS frais (ligne 218). Le moteur prenait le net aux deux
   * endroits, et imputait donc trop peu de prix d'acquisition (décision n° 159).
   */
  feesEur: DecimalString;
  /** Valeur globale du portefeuille au jour de la cession ; `null` si elle n'a pas pu être établie. */
  globalValueEur: DecimalString | null;
  ptaBefore: DecimalString;
  /** Fraction du PTA imputée sur cette cession ; `null` sans valeur globale. */
  acquisitionShareEur: DecimalString | null;
  /** Plus ou moins-value brute ; `null` sans valeur globale. */
  gainEur: DecimalString | null;
  ptaAfter: DecimalString;
}

export interface TaxYear {
  year: number;
  /** Σ des prix de cession : c'est CE total que le seuil de 305 € regarde. */
  proceedsEur: DecimalString;
  cessionCount: number;
  /** Σ des plus-values brutes de l'année. */
  gainsEur: DecimalString;
  /** Σ des moins-values brutes (valeur positive). */
  lossesEur: DecimalString;
  /**
   * Résultat net de l'année. Les moins-values ne s'imputent QUE sur les plus-values de même
   * nature de la MÊME année : un net négatif est perdu, il ne se reporte pas.
   */
  netEur: DecimalString;
  exempt: boolean;
  rate: DecimalString;
  rateLabel: string;
  /** Impôt estimé : 0 si exonéré ou si le net est négatif. */
  taxEur: DecimalString;
  /** Cessions de l'année dont la valeur globale manque : l'année est alors approximative. */
  unknownGlobalValue: number;
}

export interface TaxLedger {
  cessions: TaxCession[];
  years: TaxYear[];
  /** Prix total d'acquisition résiduel après la dernière cession — base d'une vente simulée. */
  ptaAfter: DecimalString;
  /** Cessions dont la valeur globale du portefeuille n'a pas pu être établie. */
  unknownGlobalValue: number;
  /** Entrées venues de l'extérieur sans coût connu : le PTA est alors sous-estimé. */
  externalInflows: number;
  /** Sorties vers l'extérieur : un paiement en crypto serait imposable, un transfert non. */
  externalOutflows: number;
  /** Récompenses reçues (leur régime propre n'est pas traité ici). */
  rewards: number;
}

export interface TaxInput {
  /** Grand livre EN EUROS, dans n'importe quel ordre (le module trie). */
  events: readonly LedgerEvent[];
  /**
   * Valeur globale du portefeuille à la CLÔTURE d'un jour, si elle est connue. Le module y ajoute
   * lui-même les produits des cessions du jour pour reconstituer la valeur d'AVANT la cession —
   * une clôture est postérieure à la vente, l'actif vendu n'y figure plus.
   */
  closingValueAt?: ((day: string) => Big | null) | undefined;
  /** Valeurs globales saisies à la main (prioritaires sur la reconstitution). */
  annotations?: Record<EventId, DecimalString | null> | undefined;
}

const yearOf = (at: NaiveDateTime): number => Number(at.slice(0, 4));
const dayOf = (at: NaiveDateTime): string => at.slice(0, 10);

/** Nature fiscale d'un événement : c'est la seule règle de classement du module. */
export function taxKindOf(event: LedgerEvent): TaxEventKind {
  switch (event.kind) {
    case 'trade': {
      const outCash = isFiat(event.out.asset);
      const inCash = isFiat(event.in.asset);
      if (outCash && inCash) return 'ignored';
      // Sortie vers une monnaie ayant cours légal : la seule opération imposable d'un export.
      if (inCash) return 'cession';
      if (outCash) return 'acquisition';
      // Actif numérique contre actif numérique, stablecoins compris : sursis d'imposition.
      return 'sursis';
    }
    case 'reward':
      return 'reward';
    case 'deposit':
      return 'external-in';
    case 'withdrawal':
      return 'external-out';
    case 'opening-balance':
      return 'acquisition';
    // Sans effet sur le prix total d'acquisition : coût reporté, frais de compte, ligne à qualifier.
    case 'migration':
    case 'split':
    case 'fee':
    case 'unqualified':
      return 'ignored';
    // Un revenu en especes n'est ni une acquisition ni une cession d'actif numerique : il ne
    // touche pas au prix total d'acquisition. Son propre regime -- revenus de capitaux mobiliers
    // pour un dividende -- est traite a part, jamais ici (decision n 132).
    case 'income':
      return 'ignored';
    default: {
      // **Un `default` valant « ignoré » rendrait un type d'événement neuf fiscalement invisible**,
      // sans erreur ni message : le chiffre serait simplement un peu faux. Chaque type doit donc
      // être nommé, et le compilateur refuse tout oubli ici (décision n° 129).
      const missing: never = event;
      throw new Error(`Type d'événement sans régime fiscal : ${JSON.stringify(missing)}`);
    }
  }
}

/**
 * Frais de cession **effectivement supportés** par le cédant, en euros — la ligne 214 de l'annexe
 * 2086 : frais bruts moins la remise (`docs/coinhouse-export.md` : « frais effectif = Frais −
 * Remise »). Jamais négatifs : une remise supérieure au frais ne ferait pas de la cession une
 * cession plus chère que son prix, et la ligne 214 ne porte pas de signe.
 */
export function cessionFees(event: LedgerEvent): Big {
  if (event.kind !== 'trade' || event.fee === null) return ZERO;
  const net = D(event.fee.grossEur).minus(event.fee.rebateEur);
  return net.gt(ZERO) ? net : ZERO;
}

/** Coût d'acquisition en euros porté par un événement, quand il en porte un. */
function acquisitionCost(event: LedgerEvent): Big {
  if (event.kind === 'trade') return D(event.valueEur);
  if (event.kind === 'opening-balance') return D(event.costEur);
  if (event.kind === 'deposit') return event.costEur === null ? ZERO : D(event.costEur);
  return ZERO;
}

/**
 * Un événement touche-t-il une valeur mobilière ? Une seule jambe suffit : acheter une action en
 * euros, la vendre, ou l'échanger contre une crypto sont tous hors de l'assiette du 150 VH bis.
 */
export function touchesEquity(event: LedgerEvent): boolean {
  // `IncomeEvent.asset` vaut `null` quand le revenu appartient au compte et non a une ligne.
  const legs: (AssetCode | null | undefined)[] = [
    'out' in event ? event.out.asset : undefined,
    'in' in event ? event.in.asset : undefined,
    'asset' in event ? event.asset : undefined,
  ];
  return legs.some((code) => code != null && isEquityCode(code));
}

/**
 * Rejoue le grand livre et produit l'estimation année par année.
 *
 * Hypothèse structurante, à annoncer partout où le résultat s'affiche : **le portefeuille de cette
 * app est supposé être le portefeuille entier du contribuable**. La méthode est globale ; des
 * actifs détenus ailleurs changeraient à la fois le PTA et la valeur globale.
 *
 * **Les valeurs mobilières sont écartées d'entrée** (voir l'en-tête du module) : leur régime est
 * celui de l'article 150-0 D, incompatible avec celui-ci.
 */
export function computeFrenchTax(input: TaxInput): TaxLedger {
  const events = [...input.events]
    .filter((e) => !touchesEquity(e))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const annotations = input.annotations ?? {};

  // Valeur sortie du portefeuille, par jour : elle sert à reconstituer la valeur d'avant la cession.
  // C'est le prix AVANT frais (l. 217) qui quittait le portefeuille, pas l'euro net encaissé : les
  // frais faisaient partie de ce que valaient les actifs cédés.
  const proceedsByDay = new Map<string, Big>();
  for (const event of events) {
    if (taxKindOf(event) !== 'cession' || event.kind !== 'trade') continue;
    const day = dayOf(event.at);
    const before = D(event.valueEur).plus(cessionFees(event));
    proceedsByDay.set(day, (proceedsByDay.get(day) ?? ZERO).plus(before));
  }

  let pta = ZERO;
  let externalInflows = 0;
  let externalOutflows = 0;
  let rewards = 0;
  const cessions: TaxCession[] = [];

  for (const event of events) {
    const kind = taxKindOf(event);
    if (kind === 'acquisition') {
      // Aucun compteur d'entrée sans coût connu ici : un achat ou un solde d'ouverture porte
      // toujours son coût, et `taxKindOf` rend `external-in` pour un dépôt. La ligne qui s'y
      // trouvait était une copie de la branche suivante, dans un chemin qu'aucun dépôt n'atteint.
      pta = pta.plus(acquisitionCost(event));
      continue;
    }
    if (kind === 'reward') {
      // Une récompense entre à coût nul par défaut (décision n° 9) : elle n'ajoute rien au PTA.
      rewards++;
      continue;
    }
    if (kind === 'external-in') {
      pta = pta.plus(acquisitionCost(event));
      if (event.kind === 'deposit' && event.costEur === null) externalInflows++;
      continue;
    }
    if (kind === 'external-out') {
      externalOutflows++;
      continue;
    }
    if (kind !== 'cession' || event.kind !== 'trade') continue;

    /** Ligne 218 : prix de cession net des frais (sans soulte, c'est aussi la 215). */
    const proceeds = D(event.valueEur);
    /** Ligne 214 : frais effectivement supportés. */
    const fees = cessionFees(event);
    /** Ligne 217 : prix de cession AVANT frais (sans soulte, c'est la 213). */
    const beforeFees = proceeds.plus(fees);
    const day = dayOf(event.at);
    const annotated = annotations[event.id];
    const closing = input.closingValueAt?.(day) ?? null;
    // Valeur d'avant la cession ≈ clôture du jour + ce qui est sorti du portefeuille ce jour-là.
    const globalValue =
      annotated !== undefined && annotated !== null
        ? D(annotated)
        : closing === null
          ? null
          : closing.plus(proceedsByDay.get(day) ?? ZERO);

    const ptaBefore = pta;
    let share: Big | null = null;
    let gain: Big | null = null;
    if (globalValue !== null && globalValue.gt(ZERO)) {
      /*
       * La formule de l'annexe 2086, ligne 224 : l. 218 − [l. 223 × (l. 217 / l. 212)].
       *
       * **Le rapport prend le prix AVANT frais, la soustraction le prix APRÈS frais** — deux lignes
       * différentes du formulaire, et la doctrine le dit en toutes lettres (BOI-RPPM-PVBMC-30-20,
       * § 50) : les frais « ne viennent pas en diminution du prix de cession pour la détermination du
       * quotient », ils se déduisent seulement du premier terme de la différence. La loi, elle, écrit
       * « prix de cession » aux deux endroits sans trancher. Le moteur prenait le net aux deux
       * endroits : il imputait trop
       * peu de prix d'acquisition, surestimait chaque plus-value de `PTA × frais ÷ valeur globale`,
       * et laissait un PTA trop élevé qui se propageait à toutes les cessions suivantes. C'est la
       * préparation du banc d'essai public qui l'a fait voir (décision n° 159).
       *
       * La fraction imputée ne peut pas dépasser le PTA restant (cession de tout le portefeuille).
       */
      const raw = ptaBefore.times(beforeFees).div(globalValue);
      share = raw.gt(ptaBefore) ? ptaBefore : raw;
      gain = proceeds.minus(share);
      pta = ptaBefore.minus(share);
    }
    cessions.push({
      eventId: event.id,
      at: event.at,
      year: yearOf(event.at),
      proceedsEur: toDecimalString(proceeds),
      feesEur: toDecimalString(fees),
      globalValueEur: globalValue === null ? null : toDecimalString(globalValue),
      ptaBefore: toDecimalString(ptaBefore),
      acquisitionShareEur: share === null ? null : toDecimalString(share),
      gainEur: gain === null ? null : toDecimalString(gain),
      ptaAfter: toDecimalString(pta),
    });
  }

  return {
    cessions,
    years: summarizeYears(cessions),
    ptaAfter: toDecimalString(pta),
    unknownGlobalValue: cessions.filter((c) => c.globalValueEur === null).length,
    externalInflows,
    externalOutflows,
    rewards,
  };
}

/** Agrège les cessions par année : seuil, plus et moins-values, impôt estimé. */
function summarizeYears(cessions: readonly TaxCession[]): TaxYear[] {
  const byYear = new Map<number, TaxCession[]>();
  for (const cession of cessions) {
    const list = byYear.get(cession.year) ?? [];
    list.push(cession);
    byYear.set(cession.year, list);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => {
      let proceeds = ZERO;
      let gains = ZERO;
      let losses = ZERO;
      let unknown = 0;
      for (const cession of list) {
        proceeds = proceeds.plus(cession.proceedsEur);
        if (cession.gainEur === null) {
          unknown++;
          continue;
        }
        const gain = D(cession.gainEur);
        if (gain.gte(ZERO)) gains = gains.plus(gain);
        else losses = losses.plus(gain.abs());
      }
      const net = gains.minus(losses);
      const exempt = proceeds.lte(D(EXEMPTION_THRESHOLD));
      const rate = rateFor(year);
      const tax = exempt || net.lte(ZERO) ? ZERO : net.times(rate.pfu);
      return {
        year,
        proceedsEur: toDecimalString(proceeds),
        cessionCount: list.length,
        gainsEur: toDecimalString(gains),
        lossesEur: toDecimalString(losses),
        netEur: toDecimalString(net),
        exempt,
        rate: rate.pfu,
        rateLabel: rate.label,
        taxEur: toDecimalString(tax),
        unknownGlobalValue: unknown,
      };
    });
}

/**
 * Récapitulatif façon DAC8 (décision n° 50) : ce qu'une plateforme déclarera à l'administration à
 * partir des opérations 2026 (montants bruts, unités, nombre de transactions, par actif et par an).
 * Sert à COMPARER ce que l'app voit à ce que Coinhouse déclarera — pas à déclarer soi-même.
 */
export interface Dac8AssetLine {
  asset: AssetCode;
  /** Nombre d'opérations imposables (cessions vers une monnaie ayant cours légal). */
  disposals: number;
  /** Σ des prix de cession bruts, en euros. */
  grossProceedsEur: DecimalString;
  /** Σ des quantités cédées. */
  units: DecimalString;
  /** Nombre d'acquisitions de l'année (les plateformes déclarent aussi les entrées). */
  acquisitions: number;
  acquisitionsEur: DecimalString;
}

export interface Dac8Year {
  year: number;
  lines: Dac8AssetLine[];
  totalProceedsEur: DecimalString;
  totalAcquisitionsEur: DecimalString;
}

/** Agrège les opérations d'une année par actif, dans la forme que DAC8 fait remonter. */
export function dac8Summary(events: readonly LedgerEvent[], year: number): Dac8Year {
  const byAsset = new Map<AssetCode, Dac8AssetLine>();
  const line = (asset: AssetCode): Dac8AssetLine => {
    const existing = byAsset.get(asset);
    if (existing) return existing;
    const created: Dac8AssetLine = {
      asset,
      disposals: 0,
      grossProceedsEur: '0',
      units: '0',
      acquisitions: 0,
      acquisitionsEur: '0',
    };
    byAsset.set(asset, created);
    return created;
  };

  for (const event of events) {
    if (event.kind !== 'trade' || yearOf(event.at) !== year) continue;
    const kind = taxKindOf(event);
    if (kind === 'cession') {
      const entry = line(event.out.asset);
      entry.disposals++;
      entry.grossProceedsEur = toDecimalString(D(entry.grossProceedsEur).plus(event.valueEur));
      entry.units = toDecimalString(D(entry.units).plus(event.out.qty));
    } else if (kind === 'acquisition') {
      const entry = line(event.in.asset);
      entry.acquisitions++;
      entry.acquisitionsEur = toDecimalString(D(entry.acquisitionsEur).plus(event.valueEur));
    }
  }

  const lines = [...byAsset.values()].sort((a, b) =>
    D(b.grossProceedsEur).cmp(D(a.grossProceedsEur)),
  );
  return {
    year,
    lines,
    totalProceedsEur: toDecimalString(lines.reduce((acc, l) => acc.plus(l.grossProceedsEur), ZERO)),
    totalAcquisitionsEur: toDecimalString(
      lines.reduce((acc, l) => acc.plus(l.acquisitionsEur), ZERO),
    ),
  };
}

export interface CessionPreviewInput {
  /** Prix total d'acquisition avant la cession simulée (`TaxLedger.ptaAfter`). */
  ptaBefore: Big;
  /** Produit net attendu de la vente (ligne 218). */
  proceedsEur: Big;
  /**
   * Frais attendus (ligne 214) : ils entrent dans le RAPPORT de la formule, pas dans la
   * soustraction (décision n° 159). Absents, l'aperçu les suppose nuls — il le fait déjà pour le
   * prix, qu'il ne connaît pas mieux.
   */
  feesEur?: Big | undefined;
  /** Valeur globale du portefeuille AVANT la vente (positions actuelles, cet actif compris). */
  globalValueEur: Big;
  year: number;
  /** Cessions déjà réalisées cette année (pour le seuil de 305 €). */
  yearProceedsEur?: Big | undefined;
  /** Résultat net déjà constaté cette année (les moins-values s'imputent dans l'année). */
  yearNetEur?: Big | undefined;
}

export interface CessionPreview {
  acquisitionShareEur: DecimalString;
  /** Plus ou moins-value brute de CETTE cession. */
  gainEur: DecimalString;
  /** Prix total d'acquisition qui resterait après la vente. */
  ptaAfterEur: DecimalString;
  /** Total des cessions de l'année, cette vente comprise. */
  yearProceedsEur: DecimalString;
  /** Résultat net de l'année, cette vente comprise. */
  yearNetEur: DecimalString;
  exempt: boolean;
  rate: DecimalString;
  rateLabel: string;
  /** Impôt estimé sur l'année, cette vente comprise. */
  taxEur: DecimalString;
  /** Supplément d'impôt imputable à cette vente (impôt avec − impôt sans). */
  taxDeltaEur: DecimalString;
}

/** Aperçu d'une vente en euros AVANT de la passer : la même formule, sur le PTA du jour. */
export function previewCession(input: CessionPreviewInput): CessionPreview | null {
  if (!input.globalValueEur.gt(ZERO) || !input.proceedsEur.gt(ZERO)) return null;
  const rate = rateFor(input.year);
  const yearProceedsBefore = input.yearProceedsEur ?? ZERO;
  const yearNetBefore = input.yearNetEur ?? ZERO;

  // Même formule que le grand livre : rapport sur le prix avant frais (l. 217), soustraction sur
  // le prix après frais (l. 218).
  const fees = input.feesEur !== undefined && input.feesEur.gt(ZERO) ? input.feesEur : ZERO;
  const raw = input.ptaBefore.times(input.proceedsEur.plus(fees)).div(input.globalValueEur);
  const share = raw.gt(input.ptaBefore) ? input.ptaBefore : raw;
  const gain = input.proceedsEur.minus(share);

  const taxOf = (proceeds: Big, net: Big): Big =>
    proceeds.lte(D(EXEMPTION_THRESHOLD)) || net.lte(ZERO) ? ZERO : net.times(rate.pfu);
  const before = taxOf(yearProceedsBefore, yearNetBefore);
  const yearProceeds = yearProceedsBefore.plus(input.proceedsEur);
  const yearNet = yearNetBefore.plus(gain);
  const after = taxOf(yearProceeds, yearNet);

  return {
    acquisitionShareEur: toDecimalString(share),
    gainEur: toDecimalString(gain),
    ptaAfterEur: toDecimalString(input.ptaBefore.minus(share)),
    yearProceedsEur: toDecimalString(yearProceeds),
    yearNetEur: toDecimalString(yearNet),
    exempt: yearProceeds.lte(D(EXEMPTION_THRESHOLD)),
    rate: rate.pfu,
    rateLabel: rate.label,
    taxEur: toDecimalString(after),
    taxDeltaEur: toDecimalString(after.minus(before)),
  };
}
