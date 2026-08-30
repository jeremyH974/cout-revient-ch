/**
 * Normalisation d'en-tête pour l'appariement assisté (P64) — au-delà de `canonHeader`.
 *
 * `canonHeader` (`platforms/types.ts`) met en minuscules et écrase les espaces multiples : cela
 * suffit à comparer un en-tête à une table fermée, pas à RECONNAÎTRE un en-tête inédit. Trois
 * écarts observés sur des exports réels lui échappent, et chacun a sa réponse ici :
 *
 * 1. **Les diacritiques** — « Quantité vendue », « Opération », « Contre-valeur ». Décomposition
 *    NFD puis dépose des marques combinantes : `quantite vendue`, `operation`.
 * 2. **Les parenthèses** — `Date (UTC)`, `Gross Amount (EUR)`, `Amount (CCY)`. Elles ne sont pas
 *    du bruit à jeter : elles portent le fuseau, la devise, l'unité. Elles sortent donc du texte
 *    et deviennent des **jetons d'indice** (`hints`), lisibles séparément par le score — sans quoi
 *    `Gross Amount (EUR)` et `Gross Amount (CCY)` deviendraient le même en-tête.
 * 3. **Les collages** — `sentamount`, `dateheure`, `txhash`. Un export généré par script perd
 *    régulièrement ses espaces. Le dépliage se fait par **segmentation sur un vocabulaire connu**
 *    (programmation dynamique, découpe la plus courte), jamais par une heuristique de casse : un
 *    fichier tout en minuscules n'a plus de casse à lire.
 *
 * Module pur : aucun import Svelte ni DOM, aucune dépendance.
 */

export interface NormalizedHeader {
  /** L'en-tête tel qu'il figure dans le fichier — c'est lui qu'on montre à l'utilisateur. */
  readonly raw: string;
  /** Mots normalisés, séparés par une espace simple : la forme comparable. */
  readonly text: string;
  /** Ce que portaient les parenthèses (`utc`, `eur`, `ccy`…), normalisé, dans l'ordre. */
  readonly hints: readonly string[];
}

/** Marques combinantes laissées par la décomposition NFD (accents, cédilles…). */
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Séparateurs ramenés à l'espace. `_ - . /` sont ceux de l'énoncé ; les apostrophes (droite et
 * typographique) s'y ajoutent parce que « Prix d'achat » doit donner trois mots, pas deux.
 */
const SEPARATORS = /[_\-./\\'’`"|+&,;:*#]+/g;

/** Parenthèses, crochets et accolades : contenu capturé, jamais jeté. */
const BRACKETS = /[([{]([^)\]}]*)[)\]}]/g;

/**
 * Le vocabulaire de segmentation : les mots que l'on sait reconnaître collés à d'autres.
 *
 * Il est volontairement **fermé et court**. Un vocabulaire large produirait des découpes
 * fantaisistes (`total` en `to` + `tal`), et une découpe fausse est pire qu'un collage laissé
 * intact : le collage échoue au synonyme et retombe sur la distance d'édition, la découpe fausse
 * fabrique un en-tête qui n'existe pas.
 */
export const SEGMENT_VOCABULARY: readonly string[] = [
  // Temps
  'date',
  'heure',
  'horodatage',
  'timestamp',
  'time',
  'datetime',
  'created',
  'utc',
  // Quantités
  'montant',
  'amount',
  'quantite',
  'quantity',
  'qty',
  'nombre',
  'volume',
  'gross',
  'net',
  'brut',
  'total',
  'subtotal',
  'prix',
  'price',
  'valeur',
  'value',
  'worth',
  'contre',
  'solde',
  'balance',
  // Sens
  'envoye',
  'envoi',
  'sent',
  'sortie',
  'sortant',
  'from',
  'out',
  'debit',
  'vendu',
  'vendue',
  'sold',
  'recu',
  'recue',
  'received',
  'entree',
  'entrant',
  'credit',
  'achete',
  'achetee',
  'bought',
  // Actifs
  'devise',
  'currency',
  'actif',
  'asset',
  'coin',
  'crypto',
  'token',
  'symbol',
  'symbole',
  'ticker',
  'monnaie',
  'fiat',
  // Frais
  'frais',
  'fee',
  'fees',
  'commission',
  'paid',
  // Types et notes
  'type',
  'operation',
  'transaction',
  'categorie',
  'libelle',
  'label',
  'tag',
  'kind',
  'description',
  'note',
  'notes',
  'memo',
  'commentaire',
  // Identifiants
  'hash',
  'tx',
  'txid',
  'txhash',
  'reference',
  'wallet',
  'compte',
  'account',
  'adresse',
  'address',
];

const DEFAULT_VOCABULARY: ReadonlySet<string> = new Set(SEGMENT_VOCABULARY);

/** Décomposition NFD, dépose des accents, minuscules. Aucun autre changement à ce stade. */
function fold(raw: string): string {
  return raw.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

const words = (text: string): string[] =>
  text
    .replace(SEPARATORS, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');

/**
 * Découpe la PLUS COURTE d'un collage sur le vocabulaire, ou `null` si le mot ne se couvre pas
 * entièrement. Programmation dynamique : `best[i]` est la meilleure couverture des `i` premiers
 * caractères. Deux garde-fous — pièces d'au moins deux lettres, et au plus quatre pièces — parce
 * qu'au-delà on ne déplie plus un collage, on invente un en-tête.
 */
export function segmentGlued(
  token: string,
  vocabulary: ReadonlySet<string> = DEFAULT_VOCABULARY,
): string[] | null {
  if (token.length < 6 || vocabulary.has(token)) return null;
  const n = token.length;
  const best: (string[] | null)[] = new Array<string[] | null>(n + 1).fill(null);
  best[0] = [];
  for (let end = 1; end <= n; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const prefix = best[start];
      if (prefix === undefined || prefix === null) continue;
      const piece = token.slice(start, end);
      if (piece.length < 2 || !vocabulary.has(piece)) continue;
      const candidate = [...prefix, piece];
      const current = best[end];
      if (current === null || current === undefined || candidate.length < current.length)
        best[end] = candidate;
    }
  }
  const found = best[n];
  if (found === null || found === undefined) return null;
  return found.length >= 2 && found.length <= 4 ? found : null;
}

/**
 * L'en-tête normalisé : texte comparable, indices de parenthèses à part.
 *
 * L'ordre compte. Les parenthèses sont extraites **avant** le remplacement des séparateurs, sans
 * quoi `date (utc)` perdrait ses bornes et `utc` deviendrait un mot du texte — un indice promu au
 * rang de nom, ce qui est exactement l'erreur à éviter.
 */
export function normalizeHeader(
  raw: string,
  vocabulary: ReadonlySet<string> = DEFAULT_VOCABULARY,
): NormalizedHeader {
  const folded = fold(raw);
  const hints: string[] = [];
  const withoutBrackets = folded.replace(BRACKETS, (_match, inner: string) => {
    const hint = words(inner).join(' ');
    if (hint !== '') hints.push(hint);
    return ' ';
  });
  const parts: string[] = [];
  for (const word of words(withoutBrackets)) {
    const pieces = segmentGlued(word, vocabulary);
    if (pieces === null) parts.push(word);
    else parts.push(...pieces);
  }
  return { raw: raw.trim(), text: parts.join(' '), hints };
}
