/**
 * Reconnaissance d'un fichier de « second avis » (P62) : un export qui porte des CHIFFRES CALCULÉS
 * par un autre outil, par opposition à un export transactionnel — que l'app sait déjà importer.
 *
 * **Un analyseur qui devine est pire qu'un analyseur qui renonce.** Les en-têtes reconnus ici
 * viennent de sources SECONDAIRES (Koinly et CoinTracker refusent la récupération automatisée de
 * leur documentation, vérifié le 29/08/2026) : la détection est donc volontairement tolérante sur
 * l'orthographe et **échoue en nommant les colonnes qu'elle cherchait**, jamais en analysant de
 * travers. Chaque refus porte sa raison, y compris quand la raison est « cet outil n'exporte aucun
 * chiffre calculé ».
 *
 * Les marques ne sont citées ici que comme **noms de format de fichier** : ce module ne compare
 * aucun outil, il reconnaît des colonnes.
 */
import type { CostBasisMethod, SecondOpinionTool } from '../../domain/second-opinion';

/** Seul format effectivement comparable en v1 (voir `docs/second-avis.md`). */
export type SecondOpinionFormat = 'waltio-2086';

/**
 * Champs que la détection sait situer dans un en-tête : une ligne de l'annexe 2086 chacun, plus la
 * méthode. Les numéros de ligne du formulaire servent d'alias au même titre que les libellés : un
 * tableur exporté depuis un outil fiscal les porte souvent seuls.
 */
export type SecondOpinionField =
  | 'cessionDate'
  | 'globalValue'
  | 'proceeds'
  | 'fees'
  | 'netProceeds'
  | 'soulte'
  | 'proceedsNetOfSoultes'
  | 'netProceedsAfterSoultes'
  | 'acquisition'
  | 'capitalFraction'
  | 'priorSoultes'
  | 'netAcquisition'
  | 'gain'
  | 'method';

/**
 * En-têtes acceptés par champ, comparés après normalisation (minuscules, accents retirés, espaces
 * multiples réduits, apostrophes unifiées).
 *
 * **Les numéros sont ceux du formulaire, relus sur le formulaire** — les sept millésimes du cerfa
 * n° 16043, des revenus 2019 à 2025, qui numérotent tous de la même façon (décision n° 161) : 211
 * à 218 pour le prix de cession, 220 à 223 pour le prix d'acquisition. La première version de ce
 * tableau avait été écrite sans pouvoir relire le formulaire, et numérotait 216 le prix
 * d'acquisition et 220 la plus-value — ce qu'aucun millésime n'a jamais fait : un fichier aux
 * colonnes numérotées y voyait comparer son prix d'acquisition à notre plus-value.
 *
 * **La plus-value d'une cession n'a pas de numéro** sur le formulaire : c'est la ligne de formule
 * « l. 218 − [l. 223 × (l. 217 / l. 212)] », juste au-dessus de la 224, qui est la plus-value
 * **globale du déclarant** — la somme de ses cessions. Dans un fichier à une ligne par cession, une
 * colonne « 224 » ne peut porter que la plus-value de la ligne : c'est ainsi qu'elle est lue.
 *
 * Seuls les numéros du déclarant 1 sont reconnus. Ceux du déclarant 2 (251 à 264) et de la personne
 * à charge (311 à 324) font refuser le fichier en nommant les colonnes cherchées.
 */
const HEADERS: Record<SecondOpinionField, readonly string[]> = {
  cessionDate: ['211', 'date de la cession', 'date de cession', 'date'],
  globalValue: [
    '212',
    'valeur globale du portefeuille',
    'valeur globale du portefeuille au moment de la cession',
    'valeur globale',
  ],
  proceeds: ['213', 'prix de cession', 'prix de cession brut', 'montant de la cession'],
  fees: ['214', 'frais de cession', 'frais'],
  netProceeds: ['215', 'prix de cession net des frais', 'prix de cession net'],
  soulte: [
    '216',
    'soulte recue ou versee lors de la cession',
    'soulte recue ou versee',
    'soulte',
    'soulte recue',
  ],
  proceedsNetOfSoultes: ['217', 'prix de cession net des soultes'],
  netProceedsAfterSoultes: [
    '218',
    'prix de cession net des frais et soultes',
    'prix de cession net des frais et des soultes',
  ],
  acquisition: ['220', "prix total d'acquisition", 'prix total dacquisition'],
  capitalFraction: [
    '221',
    "fractions de capital initial contenues dans le prix total d'acquisition",
    'fractions de capital initial contenues dans le prix total de cession',
    'fractions de capital initial',
  ],
  priorSoultes: [
    '222',
    "soultes recues en cas d'echanges anterieurs a la cession",
    "soultes recues en cas d'echanges anterieurs",
  ],
  netAcquisition: ['223', "prix total d'acquisition net", 'prix total dacquisition net'],
  gain: [
    '224',
    'plus-values et moins-values',
    'plus-value ou moins-value',
    'plus ou moins-value',
    'plus-value ou moins-value de la cession',
    'plus ou moins-value de la cession',
    'plus-value / moins-value',
    'plus ou moins value',
    'plus-value',
  ],
  method: ['methode', 'methode de calcul', 'method', 'cost basis method', 'calculation method'],
};

/** Colonnes de contexte, reconnues mais inutilisées : les signaler comme « inconnues » serait faux. */
const KNOWN_EXTRAS = new Set([
  '',
  'ligne',
  'no',
  'n',
  'numero',
  'annee',
  'exercice',
  'plateforme',
  'actif',
  'devise',
  'commentaire',
  'note',
  'total',
  // Colonnes de NOTRE propre export « Cessions au format 2086 » (`cessionsToCsv`), qui doit se
  // relire ici sans qu'aucune colonne soit inconnue. « Estimation complète » est un drapeau, pas un
  // montant. « Fraction du prix d'acquisition imputée » ne sort plus depuis que l'export porte les
  // numéros du formulaire — elle ne s'y trouve sur aucune ligne, et voisinait dangereusement avec la
  // 221 ; l'entrée reste pour les fichiers exportés avant ce changement, qui circulent encore.
  "fraction du prix d'acquisition imputee",
  'estimation complete',
]);

/** Pourquoi un fichier ne donne lieu à aucune comparaison chiffrée. */
export type SecondOpinionRefusal =
  /** L'export ne contient AUCUN chiffre calculé (Blockpit) : refus nommé, jamais un faux-semblant. */
  | 'no-calculated-figures'
  /** Le rapport complet n'existe qu'en PDF (Koinly) : le lire ajouterait une dépendance (décision n° 13). */
  | 'pdf-only'
  /** Format reconnu, comparaison chiffrée pas encore livrée (CoinTracking, CoinTracker). */
  | 'not-yet-comparable'
  /** Export strictement transactionnel : c'est un IMPORT, pas un second avis. */
  | 'transactions-only'
  /** En-tête non reconnu : l'écran nomme les colonnes cherchées. */
  | 'unrecognised';

export type SecondOpinionDetection =
  | {
      ok: true;
      format: SecondOpinionFormat;
      tool: SecondOpinionTool;
      columns: Partial<Record<SecondOpinionField, number>>;
      unknownColumns: string[];
      /** Méthode que le FICHIER déclare ; `unknown` quand il n'en déclare aucune. */
      declaredMethod: CostBasisMethod;
    }
  | {
      ok: false;
      reason: SecondOpinionRefusal;
      tool: SecondOpinionTool;
      found: string[];
      /** Colonnes que la détection cherchait : ce qu'un refus honnête doit pouvoir citer. */
      looked: string[];
    };

const DIACRITICS = /[̀-ͯ]/g;
const APOSTROPHES = /[‘’ʼ]/g;
const HARD_SPACES = new RegExp('[\u00a0\u202f]', 'g');

/**
 * Suffixe entre parenthèses qui n'est qu'une **unité** ou un **numéro de case** : un tableur écrit
 * volontiers « Prix de cession (€) » ou « Valeur globale du portefeuille (212) ». La liste est
 * fermée à dessein — retirer n'importe quelle parenthèse finale effacerait des libellés qui
 * distinguent réellement deux colonnes.
 */
const UNIT_SUFFIX = /\s*\((?:€|eur|euro|euros|en €|en euro|en euros|\d{3})\)$/;

/** Normalisation d'un en-tête : casse, accents, apostrophes, espaces insécables, unité finale. */
export function canonHeader(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(APOSTROPHES, "'")
    .replace(HARD_SPACES, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*$/, '')
    .replace(UNIT_SUFFIX, '');
}

/** Jeton de méthode → méthode connue. Un libellé non reconnu reste `unknown`, jamais deviné. */
export function parseCostBasisMethod(raw: string): CostBasisMethod {
  const value = canonHeader(raw);
  if (value === '') return 'unknown';
  if (/\bfifo\b|premier entre/.test(value)) return 'fifo';
  if (/\blifo\b|dernier entre/.test(value)) return 'lifo';
  if (/\bhifo\b|highest/.test(value)) return 'hifo';
  if (/\bacb\b|adjusted cost/.test(value)) return 'acb';
  if (/\bopti\b|optimi/.test(value)) return 'opti';
  if (/\bwac\b|average cost|cout moyen|moyenne ponderee|weighted average/.test(value)) return 'wac';
  if (/150 vh|methode globale|globale|2086/.test(value)) return 'fr-global';
  return 'unknown';
}

/** Index de la première colonne dont l'en-tête normalisé figure dans `names`. */
function indexOf(canonical: readonly string[], names: readonly string[]): number | undefined {
  for (const name of names) {
    const index = canonical.indexOf(name);
    if (index >= 0) return index;
  }
  return undefined;
}

/** Colonnes citées quand la détection renonce : ce qu'un refus honnête doit pouvoir nommer. */
const LOOKED_FOR: readonly string[] = [
  'Date de la cession (211)',
  'Valeur globale du portefeuille (212)',
  'Prix de cession (213)',
  'Prix de cession net des frais et soultes (218)',
  "Prix total d'acquisition net (223)",
  'Plus-value ou moins-value de la cession',
];

/**
 * Signatures d'exports **transactionnels** connus : ce sont des fichiers à IMPORTER (écran
 * Importer), pas des seconds avis. Les reconnaître permet de proposer le bon geste plutôt que de
 * renvoyer un « format non reconnu » trompeur.
 */
const TRANSACTIONAL_SIGNATURES: readonly {
  tool: SecondOpinionTool;
  reason: SecondOpinionRefusal;
  /** Toutes ces colonnes doivent être présentes. */
  all: readonly string[];
}[] = [
  // Export strictement transactionnel : aucun chiffre calculé à comparer. Refus nommé.
  { tool: 'blockpit', reason: 'no-calculated-figures', all: ['blockpit-id'] },
  {
    tool: 'blockpit',
    reason: 'no-calculated-figures',
    all: ['incoming asset', 'outgoing asset', 'transaction type'],
  },
  // Format pivot et export interne : l'app les IMPORTE déjà (docs/pivot-import.md).
  { tool: 'koinly', reason: 'transactions-only', all: ['sent amount', 'received amount'] },
  { tool: 'koinly', reason: 'transactions-only', all: ['from amount', 'to amount'] },
];

/** Signatures de rapports CHIFFRÉS reconnus, dont la comparaison n'est pas encore livrée. */
const NOT_YET_COMPARABLE: readonly {
  tool: SecondOpinionTool;
  any: readonly (readonly string[])[];
}[] = [
  {
    tool: 'cointracker',
    any: [
      ['proceeds', 'cost basis'],
      ['proceeds', 'gain/loss'],
      ['date sold', 'cost basis'],
    ],
  },
  {
    tool: 'cointracking',
    any: [
      ['sell value', 'purchase value'],
      ['realized gain', 'unrealized gain'],
      ['sell value', 'profit'],
      ['buy value', 'sell value'],
    ],
  },
];

const hasAll = (canonical: readonly string[], names: readonly string[]): boolean =>
  names.every((n) => canonical.includes(n));

/**
 * Reconnaît l'en-tête d'un fichier de second avis.
 *
 * L'annexe 2086 est acceptée dès qu'une **date de cession** et au moins un **prix de cession** ou
 * une **plus-value** sont situés : exiger les treize lignes ferait renoncer la détection sur un
 * tableur dont deux colonnes ont été retirées, pour aucun gain de sûreté — chaque valeur est de
 * toute façon relue et normalisée ligne à ligne (`claims.ts`), et une case absente devient une
 * réclamation absente, jamais un zéro.
 */
export function detectSecondOpinion(header: readonly string[]): SecondOpinionDetection {
  const found = header.map((h) => h.trim());
  if (header.length === 0) {
    return { ok: false, reason: 'unrecognised', tool: 'unknown', found, looked: [...LOOKED_FOR] };
  }
  const canonical = header.map(canonHeader);

  const columns: Partial<Record<SecondOpinionField, number>> = {};
  const matched = new Set<number>();
  for (const [field, names] of Object.entries(HEADERS) as [SecondOpinionField, string[]][]) {
    const index = indexOf(canonical, names);
    if (index !== undefined) {
      columns[field] = index;
      matched.add(index);
    }
  }
  const hasAmount =
    columns.proceeds !== undefined ||
    columns.netProceeds !== undefined ||
    columns.netProceedsAfterSoultes !== undefined ||
    columns.gain !== undefined;
  if (columns.cessionDate !== undefined && hasAmount) {
    const unknownColumns = found.filter(
      (_, i) => !matched.has(i) && !KNOWN_EXTRAS.has(canonical[i]!),
    );
    return {
      ok: true,
      format: 'waltio-2086',
      tool: 'waltio',
      columns,
      unknownColumns,
      // La méthode d'une annexe 2086 est imposée par la loi : le fichier n'a rien à déclarer.
      declaredMethod: 'fr-global',
    };
  }

  for (const signature of TRANSACTIONAL_SIGNATURES) {
    if (hasAll(canonical, signature.all)) {
      return {
        ok: false,
        reason: signature.reason,
        tool: signature.tool,
        found,
        looked: [...LOOKED_FOR],
      };
    }
  }
  for (const candidate of NOT_YET_COMPARABLE) {
    if (candidate.any.some((names) => hasAll(canonical, names))) {
      return {
        ok: false,
        reason: 'not-yet-comparable',
        tool: candidate.tool,
        found,
        looked: [...LOOKED_FOR],
      };
    }
  }
  return { ok: false, reason: 'unrecognised', tool: 'unknown', found, looked: [...LOOKED_FOR] };
}

/**
 * Refus prononcé sans lire de fichier : le rapport complet de cet outil n'existe qu'en PDF, et
 * ajouter un lecteur de PDF ajouterait une dépendance (décision n° 13). L'écran le dit et propose
 * le repli.
 */
export const KOINLY_PDF_REFUSAL: SecondOpinionDetection = {
  ok: false,
  reason: 'pdf-only',
  tool: 'koinly',
  found: [],
  looked: [...LOOKED_FOR],
};
