/**
 * Ce qu'il reste à écrire dans la déclaration, case par case (décision n° 149).
 *
 * Cinq moteurs fiscaux produisent chacun sa vue d'une année — crypto-actifs, titres, dividendes,
 * intérêts de trésorerie, prêts participatifs — plus les comptes à déclarer. **Ils ne se croisaient
 * jamais** : pour remplir une déclaration, il fallait ouvrir trois écrans, comprendre cinq formes
 * différentes et reconstituer soi-même l'ordre. Ce module les aplatit en une seule liste ordonnée :
 * une case, un montant, un formulaire, et ce qu'on sait de son report.
 *
 * **Trois refus font partie du résultat**, et c'est délibéré :
 *
 * 1. Une case dont le montant vaut zéro n'est pas écrite. Une case vide n'est pas une case à zéro.
 * 2. Une case à cocher (`2OP`, `3CN`) ne porte **aucun** montant : le module n'en invente pas.
 * 3. Ce que l'application ne sait pas — un pays non désigné, une valeur de portefeuille inconnue,
 *    une perte trop vieille pour la dernière case — sort en `caveats` au lieu d'être tu.
 *
 * Module pur : aucun DOM, aucune horloge. Les montants restent en **euros**, jamais convertis dans
 * la devise d'affichage — on ne remplit pas une déclaration française en francs suisses.
 */
import { concernedDeclarations, type DeclarationReport } from '../domain/declarations-fr';
import type { DividendTaxLedger } from '../domain/equity-income-fr';
import type { EquityTaxLedger } from '../domain/equity-tax-fr';
import type { InterestTaxLedger } from '../domain/interest-income-fr';
import type { LendingTaxLedger } from '../domain/lending/tax-fr';
import { D, ZERO, isZero, toDecimalString, type DecimalString } from '../domain/money';
import { TAX_BOXES, taxBox, taxBoxCodes, type TaxBox } from '../domain/tax-boxes';
import type { TaxLedger } from '../domain/tax-fr';

/** Le moteur d'où vient une ligne. L'ordre est celui du parcours, pas celui de l'alphabet. */
export type TaxReturnFamily =
  'crypto' | 'equity' | 'dividend' | 'interest' | 'lending' | 'accounts';

/** Nom français d'une famille, tel qu'il s'affiche à côté du montant qu'elle apporte. */
export const FAMILY_LABELS: Readonly<Record<TaxReturnFamily, string>> = {
  crypto: 'Crypto-actifs',
  equity: 'Titres',
  dividend: 'Dividendes',
  interest: 'Intérêts de trésorerie',
  lending: 'Prêts participatifs',
  accounts: 'Comptes à l’étranger',
};

/**
 * Un terme du calcul, **signé**. Leur somme vaut exactement le montant de la case : c'est ce qui
 * rend le chiffre contestable — l'utilisateur voit d'où il sort, et un test l'exige.
 */
export interface TaxReturnTerm {
  label: string;
  amountEur: DecimalString;
}

/** Un montant à écrire, et la case EXACTE où l'écrire. */
export interface TaxReturnAmount {
  /**
   * Le code où porter ce montant. Il diffère de celui de la ligne pour une **plage** : une perte
   * de prêt participatif va dans l'une des cinq cases 2TU à 2TY selon son année d'origine.
   */
  code: string;
  amountEur: DecimalString;
  /** Familles qui alimentent cette case ; deux d'entre elles s'y **additionnent**. */
  families: TaxReturnFamily[];
  terms: TaxReturnTerm[];
}

export interface TaxReturnLine {
  box: TaxBox;
  /** Vide pour un formulaire et pour une case à cocher : il n'y a rien à y écrire. */
  amounts: TaxReturnAmount[];
  /** Familles qui rendent cette ligne nécessaire, dans l'ordre du parcours. */
  families: TaxReturnFamily[];
  /** Précision propre à cette année : les cadres du 2047, le nombre de comptes, l'exonération. */
  note: string | null;
}

/** Ce que l'application ne sait pas, rattaché à la famille qui le révèle. */
export interface TaxReturnCaveat {
  family: TaxReturnFamily;
  text: string;
}

export interface TaxReturn {
  year: number;
  lines: TaxReturnLine[];
  caveats: TaxReturnCaveat[];
  /** Familles réellement concernées par cette année-là. */
  families: TaxReturnFamily[];
}

export interface TaxReturnInput {
  year: number;
  /**
   * `null` tant que l'historique de prix n'est pas chargé : sans valeur globale du portefeuille,
   * l'article 150 VH bis ne se calcule pas. Le dire vaut mieux que d'afficher une liste amputée
   * sans prévenir.
   */
  crypto: TaxLedger | null;
  equity: EquityTaxLedger;
  dividends: DividendTaxLedger;
  interest: InterestTaxLedger;
  lending: LendingTaxLedger;
  declarations: DeclarationReport;
}

/**
 * Contribution d'une famille à une case, avant regroupement. `amountEur` vaut `null` pour une case
 * simplement **concernée** — une annexe à ouvrir, une option à cocher.
 */
interface Contribution {
  boxCode: string;
  code: string;
  family: TaxReturnFamily;
  amountEur: DecimalString | null;
  terms: TaxReturnTerm[];
}

/** Une contribution qui porte vraiment un montant : `merge` ne voit que celles-là. */
type Contributed = Contribution & { amountEur: DecimalString };

const contributed = (c: Contribution): c is Contributed => c.amountEur !== null;

const FAMILY_ORDER: readonly TaxReturnFamily[] = [
  'crypto',
  'equity',
  'dividend',
  'interest',
  'lending',
  'accounts',
];

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count > 1 ? many : one}`;

/** Une case concernée sans montant : un formulaire à ouvrir, une case à cocher. */
const mark = (boxCode: string, family: TaxReturnFamily): Contribution => ({
  boxCode,
  code: boxCode,
  family,
  amountEur: null,
  terms: [],
});

/**
 * Un montant, **écarté s'il n'est pas strictement positif**. Deux raisons, et elles portent tout
 * le module :
 *
 * - Une case qu'on laisse vide n'est pas une case où écrire « 0 ».
 * - Aucune de ces cases ne reçoit un nombre négatif : une moins-value s'écrit en valeur absolue,
 *   dans **sa** case. Écrire les termes signés et laisser le signe du total choisir la case évite
 *   de dupliquer la règle « plus-value ici, moins-value là » — `3AN` reçoit `gains − pertes`,
 *   `3BN` reçoit `pertes − gains`, et une seule des deux sort positive.
 */
function amount(
  boxCode: string,
  family: TaxReturnFamily,
  terms: TaxReturnTerm[],
  code = boxCode,
): Contribution | null {
  const total = terms.reduce((acc, t) => acc.plus(D(t.amountEur)), ZERO);
  if (total.lte(ZERO)) return null;
  // Un terme nul n'explique rien et brouille les autres : « moins-values 0,00 € » à côté d'une
  // plus-value fait douter du calcul au lieu de l'éclairer. Les écarter ne change pas la somme.
  return {
    boxCode,
    code,
    family,
    amountEur: toDecimalString(total),
    terms: terms.filter((t) => !isZero(D(t.amountEur))),
  };
}

const term = (label: string, amountEur: DecimalString): TaxReturnTerm => ({ label, amountEur });

/** Un terme qui se retranche : une moins-value dans la case de la plus-value, et réciproquement. */
const negated = (label: string, value: DecimalString): TaxReturnTerm =>
  term(label, toDecimalString(D(value).times('-1')));

/**
 * La case d'une perte de prêt participatif, d'après son année d'origine. Le 2042 C millésime 2026
 * aligne cinq années sur cinq cases — « 2021 2022 2023 2024 2025 » au-dessus de « 2TU 2TV 2TW 2TX
 * 2TY » : la plus ancienne à gauche, la plus récente à droite.
 *
 * `null` quand la perte est trop ancienne pour la dernière case. Ce cas **existe** : le moteur
 * garde une cohorte tant que `année − origine ≤ 5`, alors que les cases ne couvrent que cinq
 * millésimes (`année − origine ≤ 4`). Une perte imputable cette année-ci n'est donc pas toujours
 * reportable sur la suivante — et l'écran doit le dire plutôt que de forger un code.
 */
export function carryBoxCode(year: number, origin: number): string | null {
  const range = taxBox('2TU');
  if (range === null) return null;
  const codes = taxBoxCodes(range);
  const index = codes.length - 1 - (year - origin);
  return codes[index] ?? null;
}

function cryptoContributions(
  ledger: TaxLedger | null,
  year: number,
  caveats: TaxReturnCaveat[],
): { contributions: Contribution[]; note: string | null } {
  const y = ledger?.years.find((entry) => entry.year === year);
  if (y === undefined || y.cessionCount === 0) return { contributions: [], note: null };

  // La case 2OP n'est **pas** marquée ici : elle porte les revenus de capitaux mobiliers et les
  // cessions de valeurs mobilières, pas les actifs numériques, dont l'option est la case 3CN.
  const contributions: Contribution[] = [mark('2086', 'crypto')];
  let note: string | null = null;

  if (y.exempt) {
    // Ligne 51 du 2086 : « il n'y a alors pas lieu de remplir les autres lignes de la présente
    // déclaration (à l'exception de celles vous ayant permis d'obtenir les résultats) ». Le
    // formulaire se dépose quand même — c'est lui qui établit le total.
    note = `Total des prix de cession sous le seuil de 305 € : les cessions sont exonérées, et ni 3AN ni 3BN ne se remplissent. Le 2086 se dépose tout de même, pour établir ce total.`;
  } else {
    const gains = term('Plus-values de l’année', y.gainsEur);
    const losses = term('Moins-values de l’année', y.lossesEur);
    const gain = amount('3AN', 'crypto', [gains, negated('Moins-values de l’année', y.lossesEur)]);
    contributions.push(
      ...keep(gain),
      ...keep(amount('3BN', 'crypto', [losses, negated('Plus-values de l’année', y.gainsEur)])),
    );
    // L'option pour le barème ne se pose qu'avec une plus-value à imposer.
    if (gain !== null) contributions.push(mark('3CN', 'crypto'));
  }

  if (y.unknownGlobalValue > 0)
    caveats.push({
      family: 'crypto',
      text: `${plural(y.unknownGlobalValue, 'cession n’a', 'cessions n’ont')} pas de valeur globale du portefeuille : leur plus-value n’entre dans aucun montant ci-dessus. Renseignez-la depuis le rapport avant de déclarer.`,
    });

  return { contributions, note };
}

function equityContributions(
  ledger: EquityTaxLedger,
  year: number,
): { contributions: Contribution[] } {
  const y = ledger.years.find((entry) => entry.year === year);
  if (y === undefined || y.cessions.length === 0) return { contributions: [] };

  const contributions: Contribution[] = [
    mark('2047', 'equity'),
    mark('2074', 'equity'),
    mark('2OP', 'equity'),
  ];
  if (y.carryForward.length > 0 || !isZero(D(y.carryImputedEur)))
    contributions.push(mark('2074-CMV', 'equity'));

  contributions.push(
    ...keep(
      amount('3VG', 'equity', [
        term('Plus-values de l’année', y.gainsEur),
        negated('Moins-values de l’année', y.lossesEur),
        negated('Moins-values antérieures imputées', y.carryImputedEur),
      ]),
    ),
    ...keep(
      amount('3VH', 'equity', [
        term('Moins-values de l’année', y.lossesEur),
        negated('Plus-values de l’année', y.gainsEur),
      ]),
    ),
  );
  return { contributions };
}

function dividendContributions(
  ledger: DividendTaxLedger,
  year: number,
  caveats: TaxReturnCaveat[],
): { contributions: Contribution[] } {
  const y = ledger.years.find((entry) => entry.year === year);
  if (y === undefined || isZero(D(y.grossEur))) return { contributions: [] };

  const contributions: Contribution[] = [
    mark('2047', 'dividend'),
    mark('2OP', 'dividend'),
    ...keep(
      amount('2DC', 'dividend', [
        term('Dividendes à déclarer, crédit d’impôt inclus', y.declaredEur),
      ]),
    ),
    ...keep(
      amount('8PL', 'dividend', [term('Revenus nets ouvrant droit au crédit', y.netForeignEur)]),
    ),
    ...keep(amount('8VL', 'dividend', [term('Crédit d’impôt conventionnel', y.creditEur)])),
  ];

  if (y.undesignated.length > 0)
    caveats.push({
      family: 'dividend',
      text: `${plural(y.undesignated.length, 'titre n’a', 'titres n’ont')} pas de pays de source désigné : aucun crédit d’impôt n’est calculé pour eux, et les montants ci-dessus sont donc incomplets.`,
    });
  if (!isZero(D(y.excessEur)))
    caveats.push({
      family: 'dividend',
      text: `Une part de la retenue étrangère dépasse le taux conventionnel : elle n’est pas imputable en France et ne figure dans aucune case. Sa restitution se demande à l’État de la source.`,
    });

  return { contributions };
}

function interestContributions(
  ledger: InterestTaxLedger,
  year: number,
): { contributions: Contribution[] } {
  const y = ledger.years.find((entry) => entry.year === year);
  if (y === undefined || y.count === 0) return { contributions: [] };
  return {
    contributions: [
      mark('2047', 'interest'),
      mark('2OP', 'interest'),
      ...keep(amount('2TR', 'interest', [term('Intérêts encaissés dans l’année', y.grossEur)])),
    ],
  };
}

function lendingContributions(
  ledger: LendingTaxLedger,
  year: number,
  caveats: TaxReturnCaveat[],
): { contributions: Contribution[] } {
  const y = ledger.years.find((entry) => entry.year === year);
  if (y === undefined) return { contributions: [] };
  const idle =
    isZero(D(y.interestGross)) && isZero(D(y.lossRealised)) && y.carryForward.length === 0;
  if (idle) return { contributions: [] };

  const contributions: Contribution[] = [
    mark('2OP', 'lending'),
    // Les intérêts NETS de la perte imputée : la seule case qui les reçoit est additionnée telle
    // quelle par la fiche de calculs officielle, et les cases 2TU à 2TY ne portent que les pertes
    // « non imputées ». Déclarer le brut paierait l'impôt sur une perte déjà subie.
    ...keep(
      amount('2TT', 'lending', [
        term('Intérêts encaissés dans l’année', y.interestGross),
        negated('Perte en capital imputée', y.lossImputed),
      ]),
    ),
  ];
  if (y.incomeTaxCredit !== null)
    contributions.push(
      ...keep(amount('2CK', 'lending', [term('Acompte de 12,8 % déjà retenu', y.incomeTaxCredit)])),
    );
  // Case 2BH, et non 2CG : elle porte le REVENU déjà soumis aux prélèvements sociaux, pas le
  // prélèvement. C'est lui qui est exclu de la base sociale, et sur lui que se calcule la CSG
  // déductible si l'option pour le barème est exercée (décision n° 150).
  contributions.push(
    ...keep(
      amount('2BH', 'lending', [
        term(
          'Intérêts sur lesquels la plateforme a déjà prélevé les sociaux',
          y.socialisedInterest,
        ),
      ]),
    ),
  );

  for (const cohort of y.carryForward) {
    const code = carryBoxCode(year, cohort.origin);
    if (code === null) {
      caveats.push({
        family: 'lending',
        text: `Une perte de ${cohort.origin} reste non imputée, mais aucune case ne la reçoit : elle n’est plus reportable sur ${year + 1}.`,
      });
      continue;
    }
    contributions.push(
      ...keep(
        amount(
          '2TU',
          'lending',
          [term(`Perte non imputée de ${cohort.origin}`, cohort.amount)],
          code,
        ),
      ),
    );
  }

  if (y.withholding === 'unknown')
    caveats.push({
      family: 'lending',
      text: `Le taux effectivement retenu par la plateforme ne correspond à aucun régime connu : ni 2CK ni 2CG ne sont chiffrées, faute de savoir comment ventiler ce prélèvement.`,
    });
  if (!isZero(D(y.expired)))
    caveats.push({
      family: 'lending',
      text: `Une perte est arrivée au terme des cinq ans sans avoir trouvé d’intérêts sur lesquels s’imputer : elle est définitivement perdue, et ne se reporte nulle part.`,
    });

  return { contributions };
}

function accountContributions(
  report: DeclarationReport,
  caveats: TaxReturnCaveat[],
): { contributions: Contribution[]; note: string | null } {
  const concerned = concernedDeclarations(report);
  if (concerned.length === 0) return { contributions: [], note: null };

  if (report.uncertainCount > 0)
    caveats.push({
      family: 'accounts',
      text: `${plural(report.uncertainCount, 'compte auto-hébergé n’est', 'comptes auto-hébergés ne sont')} pas tranché par le texte : l’application ne le compte pas comme à déclarer, et ne conclut pas non plus qu’il ne l’est pas.`,
    });

  // Le troisième statut, celui qu'on oublie : un compte sans pays renseigné n'est ni dedans ni
  // dehors. Le taire ferait passer « aucun compte à déclarer » pour une réponse, alors que c'est
  // une question non posée.
  const unknown = concerned.filter((account) => account.status === 'unknown').length;
  if (unknown > 0)
    caveats.push({
      family: 'accounts',
      text: `${plural(unknown, 'compte n’a', 'comptes n’ont')} pas de pays renseigné : l’application ne peut pas dire s’il relève du 3916-bis. Renseignez-le sur l’écran Comptes.`,
    });

  return {
    contributions: [mark('3916-bis', 'accounts')],
    note:
      report.includedCount > 0
        ? `${plural(report.includedCount, 'compte à déclarer', 'comptes à déclarer')}, un formulaire par compte.`
        : `Aucun compte identifié comme étant à déclarer, mais ${plural(concerned.length, 'compte reste', 'comptes restent')} à qualifier : cette ligne est là pour que vous tranchiez, pas pour vous dire de la remplir.`,
  };
}

/** Écarte une contribution nulle sans alourdir chaque appel d'un `if`. */
function keep(contribution: Contribution | null): Contribution[] {
  return contribution === null ? [] : [contribution];
}

/**
 * Regroupe les contributions **par code de case**, dans leur ordre d'arrivée.
 *
 * Deux familles qui visent la même case s'y **additionnent** — l'utilisateur écrit un nombre, pas
 * deux. Deux codes différents restent séparés, ce qui est le cas de la plage 2TU à 2TY : chaque
 * année d'origine a sa propre case, et les additionner enverrait un total dans une seule.
 */
function merge(contributions: readonly Contributed[]): TaxReturnAmount[] {
  const order: string[] = [];
  const byCode = new Map<string, TaxReturnAmount>();
  for (const c of contributions) {
    const existing = byCode.get(c.code);
    if (existing === undefined) {
      order.push(c.code);
      byCode.set(c.code, {
        code: c.code,
        amountEur: c.amountEur,
        families: [c.family],
        terms: [...c.terms],
      });
      continue;
    }
    existing.amountEur = toDecimalString(D(existing.amountEur).plus(D(c.amountEur)));
    if (!existing.families.includes(c.family)) existing.families.push(c.family);
    existing.terms.push(...c.terms);
  }
  return order.map((code) => byCode.get(code) as TaxReturnAmount);
}

/**
 * Les cadres du 2047 concernés, **dans l'ordre du formulaire**. Le même imprimé se remplit à des
 * endroits différents selon le revenu : envoyer quelqu'un au mauvais cadre lui fait chercher une
 * ligne qui n'existe pas là où il regarde.
 */
function form2047Note(families: readonly TaxReturnFamily[]): string {
  const frames: string[] = [];
  if (families.includes('equity')) frames.push('cadre 3 (cessions de valeurs mobilières)');
  if (families.includes('dividend')) frames.push('cadre 20 (dividendes)');
  if (families.includes('interest')) frames.push('cadre 30 (intérêts)');
  return `À remplir au ${frames.join(', au ')}.`;
}

/**
 * La déclaration d'une année, case par case et dans l'ordre du parcours.
 *
 * L'ordre vient du registre canonique (`TAX_BOXES`), pas d'ici : on ouvre les annexes avant les
 * cases qu'elles alimentent. Une case sans contribution ne produit aucune ligne — la liste est
 * courte parce qu'elle ne montre que ce qui concerne réellement l'utilisateur.
 */
export function taxReturn(input: TaxReturnInput): TaxReturn {
  const caveats: TaxReturnCaveat[] = [];
  const crypto = cryptoContributions(input.crypto, input.year, caveats);
  const equity = equityContributions(input.equity, input.year);
  const dividend = dividendContributions(input.dividends, input.year, caveats);
  const interest = interestContributions(input.interest, input.year);
  const lending = lendingContributions(input.lending, input.year, caveats);
  const accounts = accountContributions(input.declarations, caveats);

  const contributions = [
    ...crypto.contributions,
    ...equity.contributions,
    ...dividend.contributions,
    ...interest.contributions,
    ...lending.contributions,
    ...accounts.contributions,
  ];
  const families = FAMILY_ORDER.filter((family) => contributions.some((c) => c.family === family));

  const lines: TaxReturnLine[] = [];
  for (const box of TAX_BOXES) {
    const mine = contributions.filter((c) => c.boxCode === box.code);
    if (mine.length === 0) continue;
    const lineFamilies = FAMILY_ORDER.filter((family) => mine.some((c) => c.family === family));
    lines.push({
      box,
      // Une case à cocher et un formulaire ne portent aucun montant, quoi qu'une famille apporte.
      amounts: box.kind === 'box' ? merge(mine.filter(contributed)) : [],
      families: lineFamilies,
      note:
        box.code === '2047'
          ? form2047Note(lineFamilies)
          : box.code === '3916-bis'
            ? accounts.note
            : box.code === '2086'
              ? crypto.note
              : null,
    });
  }

  return { year: input.year, lines, caveats, families };
}
