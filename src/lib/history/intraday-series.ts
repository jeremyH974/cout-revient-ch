/**
 * Rééchantillonnage des séries intraday de plusieurs actifs sur une grille commune, et libellés
 * d'instants ISO en heure locale (ici `new Date` est légitime : ce sont de vrais instants UTC,
 * jamais des dates naïves Coinhouse).
 */
import { D, ZERO, type Big } from '../domain/money';
import type { AssetCode } from '../domain/types';
import type { IntradayPoint } from './types';

export interface IntradayValuePoint {
  /** ISO 8601 de l'instant. */
  at: string;
  value: Big;
  cost: Big;
}

export interface IntradayInput {
  points: Record<AssetCode, readonly IntradayPoint[]>;
  qty: Record<AssetCode, Big>;
  cost: Record<AssetCode, Big>;
  /** Multiplicateur de devise appliqué aux prix (1 en euros). */
  rate: string;
  fromMs: number;
  toMs: number;
  stepMs: number;
}

/** Valeur des avoirs actuels à chaque pas : dernier prix connu ≤ instant, actifs sans point ignorés. */
export function intradayValueSeries(input: IntradayInput): IntradayValuePoint[] {
  const assets = Object.keys(input.qty).filter((a) => (input.points[a]?.length ?? 0) > 0);
  const cursors: Record<AssetCode, number> = {};
  const sorted: Record<AssetCode, IntradayPoint[]> = {};
  for (const asset of assets) {
    sorted[asset] = [...(input.points[asset] ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    cursors[asset] = -1;
  }
  const totalCost = assets.reduce((acc, a) => acc.plus(input.cost[a] ?? ZERO), ZERO);
  const result: IntradayValuePoint[] = [];
  for (let t = input.fromMs; t <= input.toMs; t += input.stepMs) {
    const at = new Date(t).toISOString();
    let value = ZERO;
    let any = false;
    for (const asset of assets) {
      const list = sorted[asset]!;
      let i = cursors[asset]!;
      while (i + 1 < list.length && list[i + 1]!.at <= at) i++;
      cursors[asset] = i;
      if (i < 0) continue;
      any = true;
      value = value.plus(
        D(list[i]!.priceEur)
          .times(input.rate)
          .times(input.qty[asset] ?? ZERO),
      );
    }
    if (any) result.push({ at, value, cost: totalCost });
  }
  return result;
}

export interface InstantFormatOptions {
  /** Préfixer l'heure par le jour (« 22/08 14:30 ») : utile quand la fenêtre traverse minuit. */
  withDate?: boolean;
  /** Fuseau IANA ; par défaut celui du navigateur. */
  timeZone?: string;
}

const formatters: Record<string, Intl.DateTimeFormat> = {};

function formatter(key: string, options: Intl.DateTimeFormatOptions, locale = 'fr-FR') {
  return (formatters[key] ??= new Intl.DateTimeFormat(locale, options));
}

function zone(timeZone: string | undefined): Intl.DateTimeFormatOptions {
  return timeZone ? { timeZone } : {};
}

/** Heure locale d'un instant ISO : « 14:30 » ou « 22/08 14:30 ». */
export function formatInstant(iso: string, options: InstantFormatOptions = {}): string {
  const { withDate = false, timeZone } = options;
  const key = `${withDate ? 'dt' : 't'}:${timeZone ?? ''}`;
  return formatter(key, {
    ...(withDate ? { day: '2-digit', month: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...zone(timeZone),
  }).format(new Date(iso));
}

/** Jour local (`YYYY-MM-DD`) d'un instant ISO, dans le fuseau demandé ou celui du navigateur. */
export function localDayOf(iso: string, timeZone?: string): string {
  return formatter(
    `d:${timeZone ?? ''}`,
    { year: 'numeric', month: '2-digit', day: '2-digit', ...zone(timeZone) },
    'en-CA',
  ).format(new Date(iso));
}

/** Vrai si les deux instants ne tombent pas le même jour local. */
export function spansMidnight(firstIso: string, lastIso: string, timeZone?: string): boolean {
  return localDayOf(firstIso, timeZone) !== localDayOf(lastIso, timeZone);
}
