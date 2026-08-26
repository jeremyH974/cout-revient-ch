/**
 * Pont entre l'app et la vérification d'alertes en arrière-plan (Periodic Background Sync,
 * décision n° 38) : l'app précalcule un instantané compact (seuils EUR en chaînes décimales,
 * identifiants CoinGecko, états d'armement) que le service worker (public/sw-alert-sync.js)
 * lit au réveil, et récupère en retour les déclenchements survenus app fermée. L'instantané
 * vit dans le meta-store IndexedDB existant (`crch-state`/`meta`) : aucun schéma nouveau.
 *
 * Honnêteté avant tout : la fonctionnalité n'existe que sur Chromium, PWA installée, à une
 * fréquence choisie par le navigateur (selon l'« engagement » — rarement plus de quelques fois
 * par jour). C'est un bonus opportuniste au-dessus de la veille onglet-ouvert, jamais une
 * garantie — la seule voie garantie app fermée reste un serveur push (docs/proposals/).
 */
import {
  isAlertExpired,
  alertThresholdEur,
  MIN_TRIGGER_GAP_MS,
  type AlertPositionInput,
  type AlertRule,
  type AlertRuleState,
} from '../domain/alerts';
import type { DecimalString } from '../domain/money';
import type { AssetCode } from '../domain/types';
import { TICKERS } from '../pricing/tickers';
import {
  idbMetaDelete,
  idbMetaGet,
  idbMetaSet,
  isIndexedDbAvailable,
} from '../storage/idb-state-store';

/** Clés du meta-store — mêmes valeurs dans public/sw-alert-sync.js (à garder alignées). */
const SNAPSHOT_KEY = 'alerts.watch-snapshot';
const FIRES_KEY = 'alerts.sw-fires';
/** Étiquette d'enregistrement periodicSync — même valeur dans public/sw-alert-sync.js. */
export const ALERT_SYNC_TAG = 'crch-alerts';

/** Règle vue par le service worker : seuil précalculé, plus rien à recalculer. */
export interface AlertWatchRule {
  id: string;
  asset: AssetCode;
  coingeckoId: string;
  direction: 'below' | 'above';
  thresholdEur: DecimalString;
  /** PRU au moment de l'instantané (repris tel quel dans le journal du déclenchement). */
  pruEur: DecimalString | null;
  armed: boolean;
  lastTriggeredAtMs: number | null;
  triggerCount: number;
}

export interface AlertWatchSnapshot {
  v: 1;
  updatedAtMs: number;
  minGapMs: number;
  /** URL absolue ouverte au clic sur la notification, icône absolue de la notification. */
  notifUrl: string;
  icon: string;
  coingeckoDemoKey: string | null;
  rules: AlertWatchRule[];
}

/** Déclenchement déposé par le service worker, journalisé par l'app à l'ouverture. */
export interface SwAlertFire {
  ruleId: string;
  asset: AssetCode;
  direction: 'below' | 'above';
  thresholdEur: DecimalString;
  priceEur: DecimalString;
  pruEur: DecimalString | null;
  atMs: number;
}

export interface BuildSnapshotInput {
  rules: readonly AlertRule[];
  states: Readonly<Record<string, AlertRuleState>>;
  positions: Readonly<Record<AssetCode, AlertPositionInput>>;
  usdPerEur: DecimalString | null;
  idOverrides: Readonly<Record<AssetCode, string | null>>;
  coingeckoDemoKey: string | null;
  notifUrl: string;
  icon: string;
  nowMs: number;
}

/**
 * Construit l'instantané : uniquement les règles actives dont le seuil est calculable ET dont
 * l'actif a un identifiant CoinGecko (le service worker n'a qu'un fournisseur). Une règle sans
 * état connu est traitée comme NON armée : le service worker ne déclenche jamais ce que l'app
 * n'a pas encore initialisé. Pur : testé contre `alertThresholdEur` dans background-sync.test.ts.
 */
export function buildAlertWatchSnapshot(input: BuildSnapshotInput): AlertWatchSnapshot {
  const rules: AlertWatchRule[] = [];
  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    // Le service worker ne sait comparer qu'un prix à un seuil : une règle EXPIRÉE ou portant une
    // CONDITION COMPOSÉE (qui exige le contexte de marché) reste évaluée app ouverte seulement.
    // C'est ce qui garde l'équivalence prouvée entre `decideFires` et `evaluateAlerts`.
    if (isAlertExpired(rule, input.nowMs) || rule.gate) continue;
    const coingeckoId = input.idOverrides[rule.asset] ?? TICKERS[rule.asset]?.coingeckoId ?? null;
    if (!coingeckoId) continue;
    const position = input.positions[rule.asset] ?? null;
    const threshold = alertThresholdEur(rule, position, input.usdPerEur);
    if (threshold === null) continue;
    const state = input.states[rule.id];
    rules.push({
      id: rule.id,
      asset: rule.asset,
      coingeckoId,
      direction: rule.direction,
      thresholdEur: threshold.toString(),
      pruEur: position?.pruEur ?? null,
      armed: state?.armed === true,
      lastTriggeredAtMs: state?.lastTriggeredAtMs ?? null,
      triggerCount: state?.triggerCount ?? 0,
    });
  }
  return {
    v: 1,
    updatedAtMs: input.nowMs,
    minGapMs: MIN_TRIGGER_GAP_MS,
    notifUrl: input.notifUrl,
    icon: input.icon,
    coingeckoDemoKey: input.coingeckoDemoKey,
    rules,
  };
}

/** Écrit (ou efface, si `null`) l'instantané ; meilleur effort, jamais bloquant. */
export async function writeAlertWatchSnapshot(snapshot: AlertWatchSnapshot | null): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    if (snapshot === null) await idbMetaDelete(SNAPSHOT_KEY);
    else await idbMetaSet(SNAPSHOT_KEY, snapshot);
  } catch {
    // IndexedDB indisponible (navigation privée stricte) : la veille onglet-ouvert reste là.
  }
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
const isDec = (v: unknown): v is string => typeof v === 'string' && DECIMAL.test(v);

function sanitizeFire(raw: unknown): SwAlertFire | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (typeof f['ruleId'] !== 'string' || typeof f['asset'] !== 'string') return null;
  if (f['direction'] !== 'below' && f['direction'] !== 'above') return null;
  if (!isDec(f['thresholdEur']) || !isDec(f['priceEur'])) return null;
  if (typeof f['atMs'] !== 'number' || !Number.isFinite(f['atMs'])) return null;
  return {
    ruleId: f['ruleId'],
    asset: f['asset'],
    direction: f['direction'],
    thresholdEur: f['thresholdEur'],
    priceEur: f['priceEur'],
    pruEur: isDec(f['pruEur']) ? f['pruEur'] : null,
    atMs: f['atMs'],
  };
}

/** Récupère puis efface les déclenchements déposés par le service worker (app fermée). */
export async function takePendingSwFires(): Promise<SwAlertFire[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const raw = await idbMetaGet<unknown>(FIRES_KEY);
    if (raw === undefined) return [];
    await idbMetaDelete(FIRES_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(sanitizeFire).filter((f): f is SwAlertFire => f !== null);
  } catch {
    return [];
  }
}

interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
}

export type BackgroundSyncStatus = 'unsupported' | 'idle' | 'registered' | 'denied';

/** Vrai si le navigateur expose l'API (Chromium) — ne dit rien de la permission. */
export function periodicSyncSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof ServiceWorkerRegistration !== 'undefined' &&
    'periodicSync' in ServiceWorkerRegistration.prototype
  );
}

/**
 * Aligne l'enregistrement periodicSync sur l'état voulu. `denied` signifie en pratique « PWA
 * non installée ou engagement insuffisant » : Chromium n'accorde la permission qu'aux apps
 * installées. Jamais d'erreur : la veille onglet-ouvert ne dépend pas de ce bonus.
 */
export async function syncAlertWatchTask(
  wanted: boolean,
  watchMinutes: number,
): Promise<BackgroundSyncStatus> {
  if (!periodicSyncSupported()) return 'unsupported';
  try {
    // `getRegistration` (et non `ready`, qui ne se résout jamais sans service worker — dev).
    const registration = await navigator.serviceWorker.getRegistration();
    const sync = (registration as { periodicSync?: PeriodicSyncManager } | undefined)?.periodicSync;
    if (!sync) return 'unsupported';
    if (!wanted) {
      await sync.unregister(ALERT_SYNC_TAG);
      return 'idle';
    }
    // Le navigateur impose son propre plancher (souvent ≥ 12 h) : `minInterval` n'est qu'un vœu.
    await sync.register(ALERT_SYNC_TAG, {
      minInterval: Math.max(60, watchMinutes) * 60_000,
    });
    return 'registered';
  } catch {
    return wanted ? 'denied' : 'idle';
  }
}
