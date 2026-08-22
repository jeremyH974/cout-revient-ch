/**
 * Normalisation des lignes brutes Coinhouse en événements du grand livre.
 * Fonction pure, rejouée sur le grand livre complet à chaque chargement.
 */
import { D, isZero, toDecimalString } from '../../domain/money';
import type {
  EventId,
  LedgerEvent,
  Qualification,
  RawCoinhouseRow,
  RowKey,
} from '../../domain/types';
import { absDecimal, applyQualification, buildSingleEvent, normalizeType } from './qualify';
import { buildTradeEvent, unqualifiedFromRows } from './trade';

export interface NormalizeIssue {
  eventId: EventId | null;
  rowKeys: RowKey[];
  message: string;
}

export interface NormalizeResult {
  events: LedgerEvent[];
  issues: NormalizeIssue[];
}

/** Jours entre deux horodatages naïfs (calcul en UTC, aucune conversion de fuseau). */
function daysBetween(a: string, b: string): number {
  const toUtc = (s: string): number => {
    const [y, mo, d, h, mi, sec] = s.split(/[-T:]/).map(Number) as number[];
    return Date.UTC(y!, mo! - 1, d!, h!, mi!, sec!);
  };
  return (toUtc(b) - toUtc(a)) / 86_400_000;
}

const MIGRATION_WINDOW_DAYS = 3;

export function normalizeCoinhouseRows(
  rows: RawCoinhouseRow[],
  qualifications: Record<EventId, Qualification> = {},
): NormalizeResult {
  const events: LedgerEvent[] = [];
  const groups = new Map<string, RawCoinhouseRow[]>();
  const singles: RawCoinhouseRow[] = [];
  for (const row of rows) {
    if (!row.id) {
      singles.push(row);
      continue;
    }
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }

  const delistings: RawCoinhouseRow[] = [];
  const migrations: RawCoinhouseRow[] = [];
  for (const [id, group] of groups) {
    const first = group[0]!;
    const type = normalizeType(first.type);
    if (type === 'echange') events.push(buildTradeEvent(id, group));
    else if (type === 'echange delisting' && group.length === 1) delistings.push(first);
    else if (type === 'migration' && group.length === 1) migrations.push(first);
    else if (group.length === 1) events.push(buildSingleEvent(first));
    else
      events.push(
        unqualifiedFromRows(`ch:${id}`, group, `Type de transaction inconnu : « ${first.type} ».`),
      );
  }

  for (const row of singles) {
    if (normalizeType(row.type) !== 'abonnement') {
      events.push(buildSingleEvent(row));
      continue;
    }
    const amount = D(row.valueEur ?? row.qty).abs();
    if (isZero(amount)) continue;
    events.push({
      kind: 'fee',
      id: `ch:fee:${row.key}`,
      at: row.at,
      source: 'coinhouse-csv',
      scope: 'coinhouse',
      rowKeys: [row.key],
      warnings: [],
      amountEur: toDecimalString(amount),
      label: 'Abonnement Coinhouse',
    });
  }

  // Delisting + Migration (même compte, 0 à 3 jours après) = migration d'un actif vers un autre.
  delistings.sort((a, b) => a.at.localeCompare(b.at));
  migrations.sort((a, b) => a.at.localeCompare(b.at));
  const paired = new Set<RowKey>();
  for (const d of delistings) {
    const m = migrations.find(
      (x) =>
        !paired.has(x.key) &&
        x.account === d.account &&
        x.at >= d.at &&
        daysBetween(d.at, x.at) <= MIGRATION_WINDOW_DAYS,
    );
    if (!m) {
      events.push(unqualifiedFromRows(`ch:${d.id}`, [d], 'Delisting sans migration associée.'));
      continue;
    }
    paired.add(m.key);
    events.push({
      kind: 'migration',
      id: `ch:mig:${d.id}+${m.id}`,
      at: d.at,
      source: 'coinhouse-csv',
      scope: 'coinhouse',
      rowKeys: [d.key, m.key],
      warnings: [],
      out: { asset: d.asset, qty: absDecimal(d.qty) },
      in: { asset: m.asset, qty: m.qty },
      fairValueOutEur: d.valueEur ? absDecimal(d.valueEur) : null,
      fairValueInEur: m.valueEur ? absDecimal(m.valueEur) : null,
    });
  }
  for (const m of migrations) {
    if (!paired.has(m.key))
      events.push(unqualifiedFromRows(`ch:${m.id}`, [m], 'Migration sans delisting associé.'));
  }

  // Qualifications utilisateur : réinterprétation sans toucher au brut.
  const issues: NormalizeIssue[] = [];
  const result: LedgerEvent[] = [];
  for (const event of events) {
    if (event.kind !== 'unqualified') {
      result.push(event);
      continue;
    }
    const q = qualifications[event.id];
    if (!q) {
      issues.push({ eventId: event.id, rowKeys: event.rowKeys, message: event.reason });
      result.push(event);
      continue;
    }
    const qualified = applyQualification(event, q);
    if (qualified) result.push(qualified);
  }
  result.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { events: result, issues };
}
