/**
 * Le vocabulaire des cases de déclaration (décision n° 147).
 *
 * Quatre registres de cases existaient déjà — `EQUITY_TAX_BOXES`, `DIVIDEND_TAX_BOXES`,
 * `INTEREST_TAX_BOXES`, et `TAX_BOXES` de `lending/` — chacun local à son module, sans type commun.
 * Le module crypto, le plus visible à l'écran, n'en avait **aucun**. Trois défauts en découlaient :
 *
 * 1. **Le champ `box` portait deux notions.** `{ box: '2074', form: '2074' }` ne désigne pas une
 *    case à montant mais un **formulaire** ; on ne les distinguait que par l'accident `box === form`.
 *    D'où `kind` ici.
 * 2. **Le registre des prêts divergeait** : ni `form`, ni `sourceId`, et un `carry` valant
 *    `'2TU→2TY'` — une plage logée dans un champ qui porte partout ailleurs un code unique. D'où
 *    `throughCode`.
 * 3. **Les cases crypto n'existaient nulle part** : `3AN`, `3BN` et `3CN` manquaient au dépôt entier.
 *
 * **Ce registre est canonique, mais il ne remplace rien.** Les quatre registres locaux restent où
 * ils sont, et un test les y **adosse** — même dispositif que les listes d'`ARCHITECTURE.md`
 * (décision n° 90) et que `tax-source.test.ts`, qui croise déjà les `sourceId` avec la table de
 * veille. Réécrire quatre modules et leurs écrans pour supprimer une duplication que le test rend
 * inoffensive coûterait plus qu'elle ne pèse.
 *
 * Module pur : aucun montant, aucune horloge, aucun `Big`. C'est une table de vocabulaire.
 */

/**
 * Une case porte un montant, une case à **cocher** n'en porte aucun, un formulaire s'ouvre et se
 * remplit. Ce ne sont pas les mêmes objets, et l'écran de report ne les traite pas pareil.
 *
 * `checkbox` est né de l'écran (décision n° 149) : la notice du 2086 millésime 2026 écrit « Si vous
 * optez pour l'imposition de vos plus-values au barème progressif, n'oubliez pas de **cocher** la
 * case 3CN de la 2042 C ». Afficher un montant à recopier à côté d'une case qui se coche ferait
 * écrire un chiffre là où il n'en faut aucun — et c'est précisément ce que l'écran aurait fait,
 * `kind` ne distinguant que la case du formulaire.
 */
export type TaxBoxKind = 'box' | 'checkbox' | 'form';

/**
 * D'où vient le montant **dans la déclaration en ligne**, pour la situation que cette application
 * connaît : un prestataire français de crypto-actifs et un courtier **étranger**.
 *
 * - `typed` — à saisir soi-même.
 * - `carried` — l'annexe la remplit **automatiquement** ; la saisir à la main serait au mieux
 *   inutile, au pire une double déclaration. Cas vérifié pour `3AN`/`3BN` : « Le montant renseigné
 *   remplira automatiquement la case 3AN (plus-value) ou 3BN (moins-value) ».
 * - `prefilled` — l'administration la pré-remplit depuis un imprimé fiscal unique **français**.
 *   Ne concerne donc PAS un courtier étranger, qui n'en transmet aucun : pour lui, tout se saisit.
 *   La valeur est conservée parce qu'un utilisateur peut détenir par ailleurs un compte français.
 *
 * L'hypothèse est écrite ici plutôt que supposée : elle dépend de la situation, et l'écran doit la
 * rappeler au lieu de la faire passer pour une règle.
 */
export type TaxEntryMode = 'typed' | 'carried' | 'prefilled';

export interface TaxBox {
  /** Code officiel : `3VG`, `2TT`, ou un numéro de formulaire quand `kind` vaut `'form'`. */
  code: string;
  kind: TaxBoxKind;
  /** Dernière case d'une plage continue — `2TU` à `2TY` n'est pas un code, c'est cinq cases. */
  throughCode?: string;
  /** Formulaire qui porte la case (`2042`, `2042 C`), ou le formulaire lui-même. */
  form: string;
  label: string;
  /** Référence légale, telle qu'un juriste la citerait. */
  ref: string;
  /** Entrée de veille qui porte le texte (`src/lib/watch/entries.ts`), quand il y en a une. */
  sourceId?: string;
  entry: TaxEntryMode;
  /**
   * Ce que la source dit **exactement** du report, quand `entry` seul induirait en erreur
   * (décision n° 149). Trois cas réels, et trois seulement : le report vérifié en ligne mais
   * manuel sur papier (3AN, 3BN), le report supposé mais non établi (3VG, 3VH), et la case qui se
   * remplit sur une annexe avant d'être reportée (8PL).
   *
   * Écrit ici plutôt qu'à l'écran : c'est une donnée sourcée, pas une tournure de phrase.
   */
  entryNote?: string;
}

/**
 * **L'ordre est une donnée, pas une présentation.** Il suit les dépendances réelles du parcours en
 * ligne : on ouvre les annexes d'abord, et les cases qu'elles alimentent se remplissent ensuite.
 * Remplir 2047 après avoir vérifié 2DC écraserait un montant déjà juste.
 *
 * Séquence : revenus étrangers (2047) → titres (2074) → actifs numériques (2086) → les cases
 * saisies directement sur la 2042-C → les comptes détenus à l'étranger.
 */
export const TAX_BOXES: readonly TaxBox[] = [
  // --- 1. Revenus de source étrangère : l'annexe d'abord, ses cases ensuite ---------------------
  {
    code: '2047',
    kind: 'form',
    form: '2047',
    label: 'Revenus encaissés à l’étranger — obligatoire dès que le payeur est hors de France',
    ref: 'CGI art. 170',
    sourceId: 'formulaire-2047-cadre-20',
    entry: 'typed',
  },
  {
    code: '2DC',
    kind: 'box',
    form: '2042',
    label: 'Revenus des actions et parts — net encaissé, crédit d’impôt inclus (ligne 208)',
    ref: 'CGI art. 108, 158-3',
    sourceId: 'formulaire-2047-cadre-20',
    entry: 'carried',
  },
  {
    code: '2TS',
    kind: 'box',
    form: '2042',
    label: 'Autres revenus distribués, quand l’abattement de 40 % ne s’applique pas',
    ref: 'CGI art. 158-3',
    sourceId: 'formulaire-2047-cadre-20',
    entry: 'carried',
  },
  {
    code: '2TR',
    kind: 'box',
    form: '2042',
    label: 'Intérêts et autres produits de placement à revenu fixe',
    ref: 'CGI art. 125 A',
    sourceId: 'formulaire-2047-cadre-30',
    entry: 'carried',
  },
  {
    code: '8PL',
    kind: 'box',
    form: '2042 C',
    label: 'Revenus nets de source étrangère ouvrant droit à ce crédit',
    ref: 'CGI art. 199 ter',
    sourceId: 'case-8vl',
    entry: 'carried',
    entryNote:
      'La notice 2047 millésime 2026 écrit que ce montant « doit être indiqué en 8PL, puis reporté dans la 2042 C » : il se calcule sur l’annexe, et c’est de là qu’il vient.',
  },
  {
    code: '8VL',
    kind: 'box',
    form: '2042 C',
    label: 'Impôt payé à l’étranger ouvrant droit à un crédit d’impôt — NON restituable',
    ref: 'CGI art. 199 ter',
    sourceId: 'case-8vl',
    entry: 'carried',
  },

  // --- 2. Cessions de valeurs mobilières --------------------------------------------------------
  {
    code: '2074',
    kind: 'form',
    form: '2074',
    label: 'Détail des cessions et des moins-values antérieures',
    ref: 'CGI art. 150-0 D',
    sourceId: 'form-2074',
    entry: 'typed',
  },
  {
    code: '2074-CMV',
    kind: 'form',
    form: '2074-CMV',
    label: 'Moins-values antérieures reportables et leur imputation',
    ref: 'CGI art. 150-0 D, 11',
    sourceId: 'report-mv-10-ans',
    entry: 'typed',
  },
  {
    code: '3VG',
    kind: 'box',
    form: '2042 C',
    label: 'Plus-value de cession de valeurs mobilières, avant abattement',
    ref: 'CGI art. 150-0 D',
    sourceId: 'cases-3vg-3vh',
    entry: 'carried',
    entryNote:
      'Le report automatique depuis la 2074 n’est affirmé par aucune source primaire relue ici : vérifiez la case après avoir validé l’annexe, et ne la saisissez que si elle est restée vide.',
  },
  {
    code: '3VH',
    kind: 'box',
    form: '2042 C',
    label: 'Moins-value de l’année, après compensation avec les plus-values de l’année',
    ref: 'CGI art. 150-0 D, 11',
    sourceId: 'report-mv-10-ans',
    entry: 'carried',
    entryNote:
      'Le report automatique depuis la 2074 n’est affirmé par aucune source primaire relue ici : vérifiez la case après avoir validé l’annexe, et ne la saisissez que si elle est restée vide.',
  },

  // --- 3. Cessions d'actifs numériques ----------------------------------------------------------
  {
    code: '2086',
    kind: 'form',
    form: '2086',
    label: 'Détail des cessions de crypto-actifs, une ligne par cession',
    ref: 'CGI art. 150 VH bis',
    sourceId: 'seuil-305',
    entry: 'typed',
  },
  {
    code: '3AN',
    kind: 'box',
    form: '2042 C',
    label: 'Plus-value de cession de crypto-actifs de l’année',
    ref: 'CGI art. 150 VH bis',
    sourceId: 'pfu-31_4',
    entry: 'carried',
    entryNote:
      'En ligne, l’annexe la remplit : « Le montant renseigné remplira automatiquement la case 3AN (plus-value) ou 3BN (moins-value) ». Sur papier, la ligne 52 du 2086 dit « à reporter ligne 3AN de la 2042 C » — c’est alors à vous de l’écrire.',
  },
  {
    code: '3BN',
    kind: 'box',
    form: '2042 C',
    label: 'Moins-value de l’année — imputable sur les seules plus-values de même nature',
    ref: 'CGI art. 150 VH bis',
    sourceId: 'pfu-31_4',
    entry: 'carried',
    entryNote:
      'En ligne, l’annexe la remplit : « Le montant renseigné remplira automatiquement la case 3AN (plus-value) ou 3BN (moins-value) ». Sur papier, la ligne 52 du 2086 dit « à reporter ligne 3BN de la 2042 C » — c’est alors à vous de l’écrire.',
  },
  {
    code: '3CN',
    kind: 'checkbox',
    form: '2042 C',
    label: 'Option pour le barème progressif, propre aux crypto-actifs',
    // L'article 200 C, et non le 200 A : celui-ci régit la case 2OP, et c'est lui seul dont la loi
    // de finances pour 2026 a levé le caractère irrévocable (décision n° 168).
    ref: 'CGI art. 200 C',
    sourceId: 'bareme-actifs-numeriques',
    entry: 'typed',
    entryNote:
      'Une case à cocher, sans montant : « n’oubliez pas de cocher la case 3CN de la 2042 C » (notice 2086). Distincte de la case 2OP, qui porte sur les revenus de capitaux mobiliers et les cessions de valeurs mobilières.',
  },

  // --- 4. Cases saisies directement --------------------------------------------------------------
  {
    code: '2TT',
    kind: 'box',
    form: '2042',
    label: 'Intérêts des prêts participatifs et des minibons',
    ref: 'CGI art. 125-00 A',
    sourceId: 'case-2tt',
    entry: 'prefilled',
    entryNote:
      'La plateforme déclare ces intérêts à l’administration : « en principe, ce montant est prérempli ». Il porte les intérêts BRUTS — si une perte s’impute, la notice demande d’inscrire le net « après avoir rayé le montant prérempli ».',
  },
  {
    code: '2CK',
    kind: 'box',
    form: '2042',
    label: 'Prélèvement forfaitaire déjà acquitté',
    ref: 'CGI art. 125 A',
    sourceId: 'pfu-rcm-31_4',
    entry: 'typed',
  },
  {
    code: '2BH',
    kind: 'box',
    form: '2042',
    label: 'Revenus déjà soumis aux prélèvements sociaux, avec CSG déductible sur option',
    ref: 'CGI art. 154 quinquies, II',
    sourceId: 'csg-deductible',
    entry: 'prefilled',
    entryNote:
      'Elle porte le montant des REVENUS déjà soumis aux prélèvements sociaux, jamais le prélèvement lui-même : c’est lui qui est « exclu de la base de calcul des prélèvements sociaux », et sur lequel l’administration calcule la CSG déductible (6,8 %) si vous optez pour le barème.',
  },
  {
    code: '2TU',
    throughCode: '2TY',
    kind: 'box',
    form: '2042 C',
    label: 'Pertes non imputées à reporter, par année d’origine',
    ref: 'CGI art. 125-00 A',
    sourceId: 'case-2tt',
    entry: 'typed',
  },
  {
    code: '2OP',
    kind: 'checkbox',
    form: '2042',
    label: 'Option pour le barème progressif',
    ref: 'CGI art. 200 A',
    sourceId: 'bareme-progressif',
    entry: 'typed',
    entryNote:
      'Une case à cocher, sans montant, et une décision que cette application ne prend pas : elle porte sur l’ensemble du foyer, dont elle ne connaît ni les autres revenus ni le taux marginal. Distincte de la case 3CN, propre aux crypto-actifs.',
  },

  // --- 5. Comptes détenus à l'étranger -----------------------------------------------------------
  {
    code: '3916-bis',
    kind: 'form',
    form: '3916-bis',
    label: 'Comptes de crypto-actifs ouverts, détenus, utilisés ou clos à l’étranger',
    ref: 'CGI art. 1649 bis C',
    sourceId: 'delai-reprise-10-ans',
    entry: 'typed',
  },
];

/**
 * Trois codes sont absents **exprès**, et un test l'exige.
 *
 * - `8UU` et `8TT` : leur rattachement aux comptes de **crypto-actifs** n'a pas été établi sur
 *   source primaire, et `declarations-fr.ts` s'en passe déjà — il rend un statut par compte, pas
 *   une case.
 * - `2CG` : la brochure pratique 2026 en donne une liste **fermée** — « les produits suivants qui
 *   n'ouvrent **jamais** droit à CSG déductible » : fonds en euros d'assurance-vie, FCPR/SCR
 *   déchus, comptes courants d'associés au régime social des indépendants. Rien de ce que cette
 *   application connaît n'y entre ; ce qu'elle connaît va en **2BH** (décision n° 150).
 *
 * Écrire un code de case faux serait pire que n'en écrire aucun : l'utilisateur le recopierait.
 */
export const TAX_BOXES_DELIBERATELY_ABSENT: readonly string[] = ['8UU', '8TT', '2CG'];

const BY_CODE = new Map(TAX_BOXES.map((box) => [box.code, box]));

/** La case ou le formulaire portant ce code ; `null` si le registre ne le connaît pas. */
export function taxBox(code: string): TaxBox | null {
  return BY_CODE.get(code) ?? null;
}

/** Les codes couverts par une entrée : un seul, ou toute une plage continue (`2TU`…`2TY`). */
export function taxBoxCodes(box: TaxBox): string[] {
  if (box.throughCode === undefined) return [box.code];
  const prefix = box.code.slice(0, -1);
  const from = box.code.charCodeAt(box.code.length - 1);
  const to = box.throughCode.charCodeAt(box.throughCode.length - 1);
  const codes: string[] = [];
  for (let c = from; c <= to; c += 1) codes.push(`${prefix}${String.fromCharCode(c)}`);
  return codes;
}
