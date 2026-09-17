/**
 * **L'implémentation de référence du banc d'essai d'exactitude** (P73).
 *
 * Elle recalcule, à partir des seules opérations d'un cas, chaque ligne de l'annexe 2086 que le
 * moteur doit produire. Elle est **délibérément étrangère au moteur** : ni `big.js`, ni
 * `src/lib/domain`, ni aucune dépendance — des fractions exactes en `BigInt`, et la formule
 * recopiée du formulaire et du BOFiP, pas du code de l'application. Deux implémentations écrites
 * séparément qui tombent d'accord valent davantage qu'une implémentation vérifiée contre elle-même.
 *
 * **Sa limite, dite en face** : elle est indépendante du moteur par son CODE, pas par son AUTEUR.
 * Celui qui a écrit le moteur a écrit ce fichier. Ce qui compense en partie : chaque montant
 * qu'elle produit se refait à la calculatrice, et la dérivation est publiée à côté du résultat.
 *
 * Arithmétique **exacte**, jamais arrondie : un banc d'essai qui tolérerait un écart devrait
 * d'abord justifier sa tolérance. Les cas sont choisis pour que tous leurs montants s'écrivent en
 * décimal fini ; un montant qui ne s'y prêterait pas fait échouer la génération, bruyamment.
 */

/** Un rationnel irréductible, dénominateur strictement positif. */
interface Q {
  n: bigint;
  d: bigint;
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);
const gcd = (a: bigint, b: bigint): bigint => {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const norm = (n: bigint, d: bigint): Q => {
  if (d === 0n) throw new Error('Division par zéro dans la référence.');
  const sign = d < 0n ? -1n : 1n;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
};

/** Lit un décimal écrit en chaîne (« 2970 », « 0.314 », « -12.5 »). Refuse tout le reste. */
export function q(text: string): Q {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Montant illisible pour la référence : « ${text} ».`);
  const [, sign, whole, fraction = ''] = match;
  const n = BigInt(`${whole}${fraction}`) * (sign === '-' ? -1n : 1n);
  return norm(n, 10n ** BigInt(fraction.length));
}

export const ZERO: Q = { n: 0n, d: 1n };
export const add = (a: Q, b: Q): Q => norm(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q => norm(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q): Q => norm(a.n * b.n, a.d * b.d);
export const div = (a: Q, b: Q): Q => norm(a.n * b.d, a.d * b.n);
export const cmp = (a: Q, b: Q): number => {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
};
export const min = (a: Q, b: Q): Q => (cmp(a, b) <= 0 ? a : b);

/**
 * Écrit un rationnel en décimal **fini et exact**, sans zéro superflu. Un rationnel dont le
 * dénominateur a un facteur premier autre que 2 ou 5 n'a pas d'écriture finie : on refuse, plutôt
 * que d'arrondir en silence un montant publié.
 */
export function decimal(x: Q): string {
  let d = x.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n)
    throw new Error(
      `Montant sans écriture décimale finie (${x.n}/${x.d}) : choisissez des montants de cas qui tombent juste.`,
    );
  const places = Math.max(twos, fives);
  const scaled = (x.n * 10n ** BigInt(places)) / x.d;
  const negative = scaled < 0n;
  const digits = abs(scaled)
    .toString()
    .padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = places === 0 ? '' : digits.slice(digits.length - places).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Une opération d'un cas, dans un vocabulaire neutre qu'un autre outil peut ressaisir. */
export type Operation =
  | { date: string; nature: 'achat'; actif: string; euros: string }
  | {
      date: string;
      nature: 'vente';
      actif: string;
      /** Ce que le cédant a reçu, NET des frais : la ligne 218. */
      euros: string;
      /** Frais bruts de la cession. */
      frais: string;
      /** Remise sur ces frais ; absente = aucune. */
      remise?: string;
      /** Valeur globale du portefeuille juste avant la cession : la ligne 212, donnée en entrée. */
      valeurGlobale: string;
    }
  | { date: string; nature: 'echange'; cede: string; recu: string };

/** Les lignes d'une cession, telles qu'on les porte sur l'annexe 2086. */
export interface CessionAttendue {
  date: string;
  l212: string;
  l213: string;
  l214: string;
  l217: string;
  l218: string;
  l220: string;
  l221: string;
  l223: string;
  /** La fraction du prix d'acquisition imputée : `l. 223 × (l. 217 / l. 212)`, bornée par l. 223. */
  fraction: string;
  l224: string;
  /** Ce qui reste du prix d'acquisition pour les cessions suivantes. */
  ptaApres: string;
  /** La ligne 224 refaite en toutes lettres, pour qui vérifie à la calculatrice. */
  calcul: string;
}

export interface AnneeAttendue {
  annee: number;
  /** Ligne 51 : total des prix de cession nets des frais de l'année. */
  l51: string;
  /** `n'excède pas 305 €` (CGI art. 150 VH bis) : 305 € tout rond est exonéré. */
  exoneree: boolean;
  plusValues: string;
  moinsValues: string;
  net: string;
  /** Taux global de l'année, donné par le cas avec sa source : la référence ne le devine pas. */
  taux: string;
  impot: string;
}

export interface Attendu {
  cessions: CessionAttendue[];
  annees: AnneeAttendue[];
}

/** Seuil d'exonération, CGI art. 150 VH bis : « n'excède pas 305 € au cours de l'année ». */
const SEUIL = q('305');

/**
 * Dérive toutes les lignes attendues d'un cas.
 *
 * La formule est celle de l'annexe 2086, ligne 224, confirmée par le BOFiP
 * (BOI-RPPM-PVBMC-30-20, § 50) : le quotient prend le prix de cession AVANT frais, la
 * différence le prix APRÈS frais.
 */
export function deriver(
  operations: readonly Operation[],
  taux: Readonly<Record<string, string>>,
): Attendu {
  const ordered = operations
    .map((operation, index) => ({ operation, index }))
    .sort((a, b) =>
      a.operation.date < b.operation.date
        ? -1
        : a.operation.date > b.operation.date
          ? 1
          : a.index - b.index,
    )
    .map((entry) => entry.operation);

  let acquisitions = ZERO; // ligne 220, cumulée
  let fractions = ZERO; // ligne 221, cumulée
  const cessions: CessionAttendue[] = [];
  const parAnnee = new Map<number, Q[]>();
  const prixParAnnee = new Map<number, Q>();

  for (const operation of ordered) {
    if (operation.nature === 'achat') {
      acquisitions = add(acquisitions, q(operation.euros));
      continue;
    }
    // Échange entre actifs numériques, sans soulte : sursis d'imposition, rien ne bouge.
    if (operation.nature === 'echange') continue;

    const l218 = q(operation.euros);
    const brut = q(operation.frais);
    const remise = q(operation.remise ?? '0');
    const net = sub(brut, remise);
    const l214 = cmp(net, ZERO) > 0 ? net : ZERO;
    const l213 = add(l218, l214);
    const l217 = l213; // sans soulte
    const l212 = q(operation.valeurGlobale);
    const l220 = acquisitions;
    const l221 = fractions;
    const l223 = sub(l220, l221); // sans soulte antérieure : l. 222 = 0
    const fraction = min(div(mul(l223, l217), l212), l223);
    const l224 = sub(l218, fraction);
    fractions = add(fractions, fraction);

    const annee = Number(operation.date.slice(0, 4));
    parAnnee.set(annee, [...(parAnnee.get(annee) ?? []), l224]);
    prixParAnnee.set(annee, add(prixParAnnee.get(annee) ?? ZERO, l218));

    cessions.push({
      date: operation.date.slice(0, 10),
      l212: decimal(l212),
      l213: decimal(l213),
      l214: decimal(l214),
      l217: decimal(l217),
      l218: decimal(l218),
      l220: decimal(l220),
      l221: decimal(l221),
      l223: decimal(l223),
      fraction: decimal(fraction),
      l224: decimal(l224),
      ptaApres: decimal(sub(l223, fraction)),
      calcul: `${decimal(l218)} − ${decimal(l223)} × (${decimal(l217)} ÷ ${decimal(l212)}) = ${decimal(l224)}`,
    });
  }

  const annees: AnneeAttendue[] = [...parAnnee.keys()]
    .sort((a, b) => a - b)
    .map((annee) => {
      const gains = parAnnee.get(annee)!;
      const plusValues = gains.filter((g) => cmp(g, ZERO) >= 0).reduce(add, ZERO);
      const moinsValues = gains
        .filter((g) => cmp(g, ZERO) < 0)
        .reduce((acc, g) => add(acc, sub(ZERO, g)), ZERO);
      const net = sub(plusValues, moinsValues);
      const l51 = prixParAnnee.get(annee)!;
      const exoneree = cmp(l51, SEUIL) <= 0;
      const tauxAnnee = taux[String(annee)];
      if (tauxAnnee === undefined) throw new Error(`Le cas ne donne aucun taux pour ${annee}.`);
      const impot = exoneree || cmp(net, ZERO) <= 0 ? ZERO : mul(net, q(tauxAnnee));
      return {
        annee,
        l51: decimal(l51),
        exoneree,
        plusValues: decimal(plusValues),
        moinsValues: decimal(moinsValues),
        net: decimal(net),
        taux: tauxAnnee,
        impot: decimal(impot),
      };
    });

  return { cessions, annees };
}
