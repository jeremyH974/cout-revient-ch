/**
 * Les synonymes d'en-tête, en **français et en anglais** (P64).
 *
 * C'est la table qui fait l'essentiel du travail : sur les fichiers réels, un en-tête inconnu est
 * presque toujours un en-tête connu écrit autrement — traduit, abrégé, ou nommé du point de vue de
 * la plateforme (« Débit » plutôt que « Montant envoyé »). Les deux langues cohabitent dans la même
 * liste parce qu'un même fichier les mélange régulièrement : un export français d'une plateforme
 * anglophone garde volontiers `Type` et `TxHash` à côté de « Quantité vendue ».
 *
 * Chaque entrée est écrite en clair et **normalisée au chargement** (`normalizeHeader`) : la table
 * se relit donc comme du français, et se compare comme une forme canonique. Une entrée écrite avec
 * un accent, un tiret ou une majuscule n'a aucun effet particulier — c'est voulu, personne ne doit
 * avoir à connaître le normaliseur pour ajouter un synonyme.
 *
 * ## Ce qui n'y figure PAS
 *
 * Aucun synonyme ambigu entre deux champs. `Total` va à la contre-valeur et nulle part ailleurs ;
 * `Montant` seul ne va à aucun champ — un fichier à colonne unique « Montant » est justement le
 * cas que la v1 ne traite pas (montant signé, voir `schema.ts`). Un synonyme partagé par deux
 * champs ferait gagner un appariement et en ferait perdre un autre, sans qu'on sache lequel.
 */
import { normalizeHeader } from './normalize';
import type { MappingTarget } from './schema';

/**
 * Les synonymes, écrits en clair. Le premier de chaque liste est le libellé le plus courant : il
 * sert d'exemple dans l'interface quand un champ n'est pas apparié.
 */
export const SYNONYMS: Readonly<Record<MappingTarget, readonly string[]>> = {
  date: [
    'date',
    'date utc',
    'horodatage',
    'date et heure',
    'date heure',
    'timestamp',
    'time',
    'created at',
    'datetime',
    'operation date',
    'date operation',
    'jour',
    'local time',
    'time in utc',
  ],
  sentAmount: [
    'montant envoye',
    'quantite envoyee',
    'quantite vendue',
    'montant vendu',
    'debit',
    'sortie',
    'montant sortant',
    'sent amount',
    'amount out',
    'sold amount',
    'from amount',
    'amount sent',
    'quantity sold',
    'out amount',
  ],
  sentCurrency: [
    'devise envoyee',
    'actif envoye',
    'crypto envoyee',
    'devise vendue',
    'devise debitee',
    'sent currency',
    'from currency',
    'currency out',
    'sold currency',
    'asset sent',
  ],
  receivedAmount: [
    'montant recu',
    'quantite recue',
    'quantite achetee',
    'montant achete',
    'credit',
    'entree',
    'montant entrant',
    'received amount',
    'amount in',
    'bought amount',
    'to amount',
    'amount received',
    'quantity bought',
    'in amount',
  ],
  receivedCurrency: [
    'devise recue',
    'actif recu',
    'crypto recue',
    'devise achetee',
    'devise creditee',
    'coin',
    'symbol',
    'symbole',
    'ticker',
    'asset',
    'actif',
    'to currency',
    'received currency',
    'currency in',
    'bought currency',
  ],
  feeAmount: [
    'frais',
    'montant des frais',
    'commission',
    'fee',
    'fees',
    'fee amount',
    'fees paid',
    'frais payes',
    'amount fee',
  ],
  feeCurrency: [
    'devise des frais',
    'actif des frais',
    'fee currency',
    'fees currency',
    'currency fee',
    'devise frais',
  ],
  netWorthAmount: [
    'contre valeur',
    'valeur',
    'valeur eur',
    'contre valeur eur',
    'net worth amount',
    'net worth',
    'subtotal',
    'total',
    'fiat amount',
    'montant fiat',
    'valeur de marche',
    'market value',
    'value',
  ],
  netWorthCurrency: [
    'devise de la contre valeur',
    'devise de valeur',
    'net worth currency',
    'fiat currency',
    'devise fiat',
    'value currency',
    'price currency',
  ],
  label: [
    'type',
    'operation',
    'type operation',
    'type de transaction',
    'transaction type',
    'categorie',
    'libelle',
    'etiquette',
    'label',
    'tag',
    'kind',
    'nature',
    'sens',
  ],
  description: [
    'description',
    'note',
    'notes',
    'commentaire',
    'memo',
    'remarque',
    'details',
    'libelle libre',
  ],
  txHash: [
    'hash',
    'tx hash',
    'txhash',
    'txid',
    'hash de transaction',
    'transaction hash',
    'identifiant de transaction',
    'reference blockchain',
  ],
};

/** Forme normalisée → champs qu'elle désigne. Un synonyme partagé est un synonyme à retirer. */
export const SYNONYM_INDEX: ReadonlyMap<string, readonly MappingTarget[]> = (() => {
  const index = new Map<string, MappingTarget[]>();
  for (const [field, names] of Object.entries(SYNONYMS) as [MappingTarget, readonly string[]][]) {
    for (const name of names) {
      const key = normalizeHeader(name).text;
      const known = index.get(key);
      if (known === undefined) index.set(key, [field]);
      else if (!known.includes(field)) known.push(field);
    }
  }
  return index;
})();

/** Toutes les formes normalisées d'un champ : la matière de la distance d'édition. */
export const NORMALIZED_SYNONYMS: Readonly<Record<MappingTarget, readonly string[]>> =
  Object.fromEntries(
    (Object.entries(SYNONYMS) as [MappingTarget, readonly string[]][]).map(([field, names]) => [
      field,
      [...new Set(names.map((n) => normalizeHeader(n).text))],
    ]),
  ) as unknown as Record<MappingTarget, readonly string[]>;

/**
 * En-têtes qui désignent un **solde courant**. Ils ne sont la cible d'aucun champ — le pipeline
 * pivot ne modélise pas de solde — mais leur présence change le verdict du vérificateur : avec une
 * colonne de solde, l'écart de solde se contrôle ; sans elle, il est déclaré **inapplicable**,
 * jamais réputé vert (`verify.ts`).
 */
export const BALANCE_SYNONYMS: readonly string[] = [
  'solde',
  'solde apres',
  'balance',
  'running balance',
  'solde courant',
  'balance after',
];

const BALANCE_INDEX: ReadonlySet<string> = new Set(
  BALANCE_SYNONYMS.map((n) => normalizeHeader(n).text),
);

export const isBalanceHeader = (normalized: string): boolean => BALANCE_INDEX.has(normalized);
