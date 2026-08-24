/**
 * XIRR — rendement annualisé pondéré par les flux (money-weighted), définition Excel :
 * `f(r) = Σ cf_i · (1+r)^(−(d_i−d_0)/365)`, base 365 fixe, d_0 = premier flux. Les montants
 * restent en `Big` jusqu'à la frontière du solveur ; un taux n'est pas un montant : la racine est
 * cherchée en float64 (Newton pour semer, bissection pour trancher), pour l'affichage uniquement —
 * jamais réinjectée dans un calcul monétaire (décision n° 27). Signe : achats/frais < 0, produits
 * et valeur finale > 0.
 */
import { epochDayOf } from './date';
import { D, ZERO, type Big } from './money';

export interface XirrFlow {
  /** `YYYY-MM-DD` ou date-heure naïve : seul le jour compte. */
  at: string;
  amountEur: Big;
}

export type XirrFailure = 'insufficient-flows' | 'same-sign' | 'too-recent' | 'no-convergence';

export type XirrResult =
  | { ok: true; rate: Big; since: string; until: string; flowCount: number }
  | { ok: false; reason: XirrFailure };

/** En dessous, annualiser n'a pas de sens : on n'affiche rien plutôt qu'un chiffre explosif. */
export const XIRR_MIN_SPAN_DAYS = 30;

/**
 * XIRR des flux + valeur finale du portefeuille (comptée comme un flux positif au jour `day`).
 * `valuation` à `null` pour un portefeuille intégralement soldé (les produits suffisent).
 */
export function xirrEur(
  flows: readonly XirrFlow[],
  valuation: { day: string; valueEur: Big } | null,
): XirrResult {
  const byDay = new Map<string, Big>();
  const add = (at: string, amount: Big): void => {
    const day = at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? ZERO).plus(amount));
  };
  for (const flow of flows) add(flow.at, flow.amountEur);
  if (valuation) add(valuation.day, valuation.valueEur);

  const dated: { day: string; epochDay: number; amount: Big }[] = [];
  for (const [day, amount] of byDay) {
    if (amount.eq(ZERO)) continue;
    const epochDay = epochDayOf(day);
    if (epochDay === null) continue;
    dated.push({ day, epochDay, amount });
  }
  dated.sort((a, b) => a.epochDay - b.epochDay);
  if (dated.length < 2) return { ok: false, reason: 'insufficient-flows' };
  const hasNegative = dated.some((f) => f.amount.lt(ZERO));
  const hasPositive = dated.some((f) => f.amount.gt(ZERO));
  if (!hasNegative || !hasPositive) return { ok: false, reason: 'same-sign' };
  const first = dated[0]!;
  const last = dated[dated.length - 1]!;
  if (last.epochDay - first.epochDay < XIRR_MIN_SPAN_DAYS)
    return { ok: false, reason: 'too-recent' };

  // Frontière float64 : années en base 365 fixe (comme Excel), montants en nombre.
  const ts = dated.map((f) => (f.epochDay - first.epochDay) / 365);
  const amounts = dated.map((f) => Number(f.amount.toString()));
  const rate = solve(ts, amounts);
  if (rate === null) return { ok: false, reason: 'no-convergence' };
  return {
    ok: true,
    rate: D(rate.toFixed(12)),
    since: first.day,
    until: last.day,
    flowCount: dated.length,
  };
}

const R_MIN = -1 + 1e-9;

function evaluate(ts: number[], amounts: number[], r: number): { f: number; df: number } {
  let f = 0;
  let df = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    const a = amounts[i]!;
    const pow = Math.pow(1 + r, -t);
    f += a * pow;
    df += (a * -t * pow) / (1 + r);
  }
  return { f, df };
}

function solve(ts: number[], amounts: number[]): number | null {
  const scale = amounts.reduce((acc, a) => acc + Math.abs(a), 0);
  if (!(scale > 0)) return null;
  const f = (r: number): number => evaluate(ts, amounts, r).f;

  // 1) Newton depuis 0.1 (le « guess » d'Excel) : il ne fait que SEMER la recherche — la racine
  //    est toujours tranchée par bissection, pour une précision indépendante de la pente locale.
  let seed = 0.1;
  for (let i = 0; i < 60; i++) {
    const { f: fr, df } = evaluate(ts, amounts, seed);
    if (!Number.isFinite(fr) || df === 0) break;
    let next = seed - fr / df;
    if (!Number.isFinite(next)) break;
    if (next <= R_MIN) next = (seed + R_MIN) / 2;
    if (Math.abs(next - seed) <= 1e-15 * Math.max(1, Math.abs(seed))) {
      seed = next;
      break;
    }
    seed = next;
  }

  // 2) Encadrement local autour du germe (expansion géométrique), sinon grille globale
  //    (l'intervalle retenu est alors le plus proche de 0.1, comportement à la Excel).
  let bracket: [number, number] | null = null;
  if (Number.isFinite(seed) && seed > R_MIN) {
    const fseed = f(seed);
    if (Number.isFinite(fseed)) {
      for (let h = Math.max(1e-9, Math.abs(seed) * 1e-9); h < 1e10; h *= 4) {
        const lo = Math.max(R_MIN, seed - h);
        const hi = seed + h;
        const flo = f(lo);
        const fhi = f(hi);
        if (Number.isFinite(flo) && flo * fseed <= 0) {
          bracket = [lo, seed];
          break;
        }
        if (Number.isFinite(fhi) && fseed * fhi <= 0) {
          bracket = [seed, hi];
          break;
        }
      }
    }
  }
  if (!bracket) {
    const grid = [
      R_MIN,
      -0.999999,
      -0.9999,
      -0.99,
      -0.9,
      -0.7,
      -0.5,
      -0.3,
      -0.15,
      -0.05,
      0,
      0.05,
      0.1,
      0.2,
      0.35,
      0.5,
      0.75,
      1,
      1.5,
      2,
      3,
      5,
      10,
      25,
      100,
      1e3,
      1e5,
      1e9,
    ];
    const values = grid.map((g) => f(g));
    let bestDistance = Infinity;
    for (let i = 0; i + 1 < grid.length; i++) {
      const a = values[i]!;
      const b = values[i + 1]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (a === 0) return grid[i]!;
      if (a * b < 0) {
        const distance = Math.min(Math.abs(grid[i]! - 0.1), Math.abs(grid[i + 1]! - 0.1));
        if (distance < bestDistance) {
          bestDistance = distance;
          bracket = [grid[i]!, grid[i + 1]!];
        }
      }
    }
  }
  if (!bracket) return null;

  // 3) Bissection jusqu'à la précision machine.
  let [lo, hi] = bracket;
  let flo = f(lo);
  let root = (lo + hi) / 2;
  for (let i = 0; i < 400; i++) {
    root = (lo + hi) / 2;
    const froot = f(root);
    if (froot === 0 || hi - lo <= 1e-15 * Math.max(1, Math.abs(root))) break;
    if (flo * froot <= 0) hi = root;
    else {
      lo = root;
      flo = froot;
    }
  }
  return Math.abs(f(root)) <= scale * 1e-8 && root > R_MIN ? root : null;
}
