/**
 * Oracle indépendant : recalcule PRU, quantités, coûts, réalisé, lots, frais et abonnements à
 * partir du CSV brut avec un code volontairement distinct du moteur (parseur minimal, boucle
 * naïve), puis compare au rapport du moteur à 1e-9 près. Toute divergence est une erreur de
 * calcul quelque part — à élucider, jamais à « tolérer ».
 *
 * Règles appliquées (docs/coinhouse-export.md) : coût/produit EUR = |Contre-valeur (EUR)| de la
 * jambe contrepartie (eur ou usdc) ; PRU = coût moyen pondéré, inchangé à la vente ; cession au
 * prorata des lots ; migration = coût reporté ; abonnements hors PRU ; récompenses à coût 0.
 */
import Big from 'big.js';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import type { PortfolioReport, PositionReport } from '../../src/lib/domain/engine/report';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { balanceRecords } from '../../src/lib/import/coinhouse/balances';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';
const REAL = 'historique des transactions (4).csv';
const EPS = new Big('0.000000001');

// --- Parseur minimal, indépendant de src/lib/import/csv.ts ------------------------------------

interface Row {
  id: string;
  at: string; // YYYY-MM-DDTHH:mm:ss
  type: string;
  qty: Big;
  asset: string;
  valueEur: Big | null;
  feeAsset: Big | null;
  feeEur: Big | null;
  rebate: Big | null;
  line: number;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const big = (s: string): Big | null => (s.trim() === '' ? null : new Big(s.trim()));
const isoDate = (fr: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(fr.trim());
  if (!m) throw new Error(`date inattendue : ${fr}`);
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`;
};

function parse(text: string): Row[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]!);
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`colonne absente : ${name}`);
    return i;
  };
  const c = {
    id: col('ID Coinhouse'),
    date: col('Date'),
    type: col('Type'),
    qty: col('Quantité'),
    asset: col('Devise'),
    value: col('Contre-valeur (EUR)'),
    feeAsset: col('Frais (devise)'),
    feeEur: col('Frais Contre-valeur (EUR)'),
    rebate: col('Remise frais'),
  };
  return lines.slice(1).map((line, i) => {
    const f = splitCsvLine(line);
    return {
      id: f[c.id]!.trim(),
      at: isoDate(f[c.date]!),
      type: f[c.type]!.trim(),
      qty: new Big(f[c.qty]!.trim()),
      asset: f[c.asset]!.trim().toLowerCase(),
      valueEur: big(f[c.value]!),
      feeAsset: big(f[c.feeAsset]!),
      feeEur: big(f[c.feeEur]!),
      rebate: big(f[c.rebate]!),
      line: i + 2,
    };
  });
}

// --- Moteur naïf ---------------------------------------------------------------------------------

interface Lot {
  qty: Big;
  cost: Big;
}
interface Pos {
  qty: Big;
  cost: Big;
  realized: Big;
  acquisitions: Big; // Σ coûts d'acquisition (achats, y compris payés en USDC)
  proceeds: Big; // Σ produits de cession
  feesEur: Big;
  rebatesEur: Big;
  lots: Lot[];
  pruHistory: (Big | null)[]; // PRU après chaque opération, ordre chronologique
}
const ZERO = new Big('0');

function oracle(rows: Row[]): { positions: Map<string, Pos>; subscriptions: Big } {
  const positions = new Map<string, Pos>();
  const pos = (a: string): Pos => {
    let p = positions.get(a);
    if (!p) {
      p = {
        qty: ZERO,
        cost: ZERO,
        realized: ZERO,
        acquisitions: ZERO,
        proceeds: ZERO,
        feesEur: ZERO,
        rebatesEur: ZERO,
        lots: [],
        pruHistory: [],
      };
      positions.set(a, p);
    }
    return p;
  };
  const acquire = (a: string, qty: Big, cost: Big): void => {
    const p = pos(a);
    p.qty = p.qty.plus(qty);
    p.cost = p.cost.plus(cost);
    p.acquisitions = p.acquisitions.plus(cost);
    p.lots.push({ qty, cost });
    p.pruHistory.push(p.qty.gt('0') ? p.cost.div(p.qty) : null);
  };
  const dispose = (a: string, qty: Big, proceeds: Big): void => {
    const p = pos(a);
    if (qty.gt(p.qty.plus(EPS))) throw new Error(`survente ${a} : ${qty} > ${p.qty}`);
    const fraction = qty.gte(p.qty) ? new Big('1') : qty.div(p.qty);
    const costOfSale = qty.gte(p.qty) ? p.cost : p.cost.times(fraction);
    p.realized = p.realized.plus(proceeds).minus(costOfSale);
    p.proceeds = p.proceeds.plus(proceeds);
    p.cost = p.cost.minus(costOfSale);
    p.qty = qty.gte(p.qty) ? ZERO : p.qty.minus(qty);
    for (const lot of p.lots) {
      lot.qty = lot.qty.minus(lot.qty.times(fraction));
      lot.cost = lot.cost.minus(lot.cost.times(fraction));
    }
    if (p.qty.eq('0')) {
      p.cost = ZERO;
      p.lots = [];
    }
    p.pruHistory.push(p.qty.gt('0') ? p.cost.div(p.qty) : null);
  };

  // Ordre chronologique ; à horodatage égal, ordre du fichier inversé (le fichier est antéchronologique).
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => (a.r.at < b.r.at ? -1 : a.r.at > b.r.at ? 1 : b.i - a.i));
  const byId = new Map<string, Row[]>();
  for (const { r } of indexed) {
    if (r.type === 'Echange' && r.id !== '') {
      const list = byId.get(r.id) ?? [];
      list.push(r);
      byId.set(r.id, list);
    }
  }

  let subscriptions = ZERO;
  const done = new Set<string>();
  let pendingDelisting: { asset: string; cost: Big; qty: Big } | null = null;
  for (const { r } of indexed) {
    if (r.type === 'Abonnement') {
      subscriptions = subscriptions.plus(r.valueEur ?? ZERO);
      continue;
    }
    if (r.type === 'Echange Delisting') {
      const p = pos(r.asset);
      pendingDelisting = { asset: r.asset, cost: p.cost, qty: p.qty };
      // Sortie sans produit ni réalisé : le coût — et la part d'achats correspondante — partent
      // vers l'actif de destination (transfert, pas une cession).
      p.acquisitions = p.acquisitions.minus(p.cost);
      p.qty = ZERO;
      p.cost = ZERO;
      p.lots = [];
      p.pruHistory.push(null);
      continue;
    }
    if (r.type === 'Migration') {
      if (!pendingDelisting) throw new Error(`migration sans delisting ligne ${r.line}`);
      const p = pos(r.asset);
      p.qty = p.qty.plus(r.qty);
      p.cost = p.cost.plus(pendingDelisting.cost);
      p.acquisitions = p.acquisitions.plus(pendingDelisting.cost);
      p.lots.push({ qty: r.qty, cost: pendingDelisting.cost });
      p.pruHistory.push(p.qty.gt('0') ? p.cost.div(p.qty) : null);
      pendingDelisting = null;
      continue;
    }
    if (r.type === 'Récompense') {
      // Coût d'acquisition 0 par défaut (`rewardValuation: 'zero'`) : la quantité augmente, le
      // coût est inchangé (acquisition à coût nul), aucun réalisé, aucun flux de caisse — un
      // `acquire` ordinaire avec un coût de 0 couvre exactement ce cas.
      acquire(r.asset, r.qty, ZERO);
      continue;
    }
    if (r.type !== 'Echange') throw new Error(`type inattendu ligne ${r.line} : ${r.type}`);
    if (done.has(r.id)) continue;
    done.add(r.id);
    const legs = byId.get(r.id) ?? [];
    if (legs.length !== 2) throw new Error(`opération ${r.id} : ${legs.length} jambe(s)`);
    const counter = legs.find((l) => l.asset === 'eur') ?? legs.find((l) => l.asset === 'usdc');
    const other = legs.find((l) => l !== counter);
    if (!counter || !other) throw new Error(`opération ${r.id} : jambes ambiguës`);
    const value = (counter.valueEur ?? ZERO).abs();
    // Frais (jambe contrepartie) : bruts en EUR, remise convertie au même taux.
    const feeEur = (counter.feeEur ?? ZERO).abs();
    const feeAsset = (counter.feeAsset ?? ZERO).abs();
    const rebateAsset = (counter.rebate ?? ZERO).abs();
    const rebateEur = feeAsset.gt('0') ? rebateAsset.times(feeEur).div(feeAsset) : ZERO;
    const feeOwner = pos(other.asset);
    feeOwner.feesEur = feeOwner.feesEur.plus(feeEur);
    feeOwner.rebatesEur = feeOwner.rebatesEur.plus(rebateEur);
    if (other.qty.gt('0')) {
      acquire(other.asset, other.qty, value);
      if (counter.asset === 'usdc') dispose('usdc', counter.qty.abs(), value);
    } else {
      dispose(other.asset, other.qty.abs(), value);
      if (counter.asset === 'usdc') acquire('usdc', counter.qty.abs(), value);
    }
  }
  return { positions, subscriptions };
}

// --- Comparaison ---------------------------------------------------------------------------------

function engineReport(text: string): PortfolioReport {
  const result = importCoinhouseCsv(text, {}, 'imp:oracle');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  return computePortfolio({
    events: normalizeCoinhouseRows(rows).events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
}

const close = (a: Big, b: Big): boolean => a.minus(b).abs().lte(EPS);
const str = (b: Big | null): string => (b === null ? 'null' : b.round(9).toString());

function compare(text: string): string[] {
  const { positions, subscriptions } = oracle(parse(text));
  const report = engineReport(text);
  const all: PositionReport[] = [
    ...report.positions,
    ...report.stablecoins,
    ...report.closed,
    ...report.blocked,
  ];
  const mismatches: string[] = [];
  const check = (label: string, a: Big | null, b: Big | null): void => {
    if (a === null && b === null) return;
    if (a === null || b === null || !close(a, b))
      mismatches.push(`${label} : oracle ${str(a)} ≠ moteur ${str(b)}`);
  };
  for (const [asset, o] of positions) {
    if (asset === 'eur') continue;
    const e = all.find((p) => p.asset === asset);
    if (!e) {
      if (o.qty.gt('0') || !o.realized.eq('0'))
        mismatches.push(`${asset} : absent du rapport moteur`);
      continue;
    }
    check(`${asset}.qty`, o.qty, e.qty);
    check(`${asset}.costBasis`, o.cost, e.costBasis);
    check(`${asset}.pru`, o.qty.gt('0') ? o.cost.div(o.qty) : null, e.pru);
    check(`${asset}.realized`, o.realized, e.realized);
    check(`${asset}.investedTotal`, o.acquisitions, e.investedTotal);
    check(`${asset}.proceedsTotal`, o.proceeds, e.proceedsTotal);
    check(`${asset}.feesEur (nets)`, o.feesEur.minus(o.rebatesEur), e.feesEur);
    check(`${asset}.rebatesEur`, o.rebatesEur, e.rebatesEur);
    const lotQty = o.lots.reduce((acc, l) => acc.plus(l.qty), ZERO);
    const engineLotQty = e.lots.reduce((acc, l) => acc.plus(l.qtyRemaining), ZERO);
    check(`${asset}.lots.qty`, lotQty, engineLotQty);
    const lotCost = o.lots.reduce((acc, l) => acc.plus(l.cost), ZERO);
    const engineLotCost = e.lots.reduce((acc, l) => acc.plus(l.costRemaining), ZERO);
    check(`${asset}.lots.cost`, lotCost, engineLotCost);
    // PRU après chaque opération (ordre chronologique ; le moteur liste du plus récent au plus ancien).
    const enginePru = [...e.history].reverse().map((h) => h.pruAfter);
    if (enginePru.length !== o.pruHistory.length) {
      mismatches.push(
        `${asset}.history : ${o.pruHistory.length} opérations (oracle) ≠ ${enginePru.length} (moteur)`,
      );
    } else {
      o.pruHistory.forEach((p, i) =>
        check(`${asset}.history[${i}].pruAfter`, p, enginePru[i] ?? null),
      );
    }
  }
  for (const e of all) {
    if (!positions.has(e.asset))
      mismatches.push(`${e.asset} : présent dans le moteur, absent de l'oracle`);
  }
  check('totals.subscriptionsEur', subscriptions, report.totals.subscriptionsEur);
  const acquisitions = [...positions.values()].reduce((acc, p) => acc.plus(p.acquisitions), ZERO);
  const proceeds = [...positions.values()].reduce((acc, p) => acc.plus(p.proceeds), ZERO);
  check('totals.investedTotal', acquisitions, report.totals.investedTotal);
  check('totals.proceedsTotal', proceeds, report.totals.proceedsTotal);
  check(
    'totals.realized',
    [...positions.values()].reduce((acc, p) => acc.plus(p.realized), ZERO),
    report.totals.realized,
  );
  return mismatches;
}

describe('oracle indépendant vs moteur', () => {
  it('fixture anonymisée : aucune divergence', () => {
    expect(compare(readFileSync(FIXTURE, 'utf8'))).toEqual([]);
  });

  it.skipIf(!existsSync(REAL))('export réel (local) : aucune divergence', () => {
    expect(compare(readFileSync(REAL, 'utf8'))).toEqual([]);
  });
});
