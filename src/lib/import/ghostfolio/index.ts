/**
 * Ghostfolio — export JSON d'activités (Réglages → Exporter). Le fichier peut être l'export complet
 * (`meta`, `accounts`, `platforms`, `tags`, `activities`, `user`) ou un simple `{ activities: [...] }` ;
 * seuls `accounts` (pour l'étiquette de compte) et `activities` sont exploités. `type` ∈ {BUY, SELL,
 * DIVIDEND, INTEREST, FEE, LIABILITY} (pas de ITEM) ; `value = quantity × unitPrice` est BRUT (hors
 * frais) et `fee` partage la devise de `unitPrice` (`currency`) — jamais celle de l'actif (même règle
 * d'or que l'export Coinhouse : la contre-valeur est la jambe contrepartie, pas la jambe crypto).
 * `dataSource` (COINGECKO : `symbol` = slug CoinGecko ; YAHOO : `symbol` = ticker suffixé
 * `-EUR`/`-USD`/…) décide si une DIVIDEND/INTEREST est une récompense en nature (valorisée via
 * `netWorth`) ou un revenu cash pur (ligne 100 % fiat, volontairement « ignorée cash » en aval par
 * `pivotLedgerEvents`, comme tout le reste du pipeline pivot). Format vérifié dans le code source du
 * dépôt ghostfolio/ghostfolio, branche main, le 24/08/2026.
 */
import { normalizeAssetCode } from '../../domain/assets';
import { D, ZERO } from '../../domain/money';
import type { AccountId, EventId, Qualification, RawPivotRow, RowKey } from '../../domain/types';
import { TICKERS } from '../../pricing/tickers';
import { draftsToPivotRows } from '../platforms/drafts';
import type { PlatformDraft } from '../platforms/types';
import type { UsdRate } from '../pivot/events';
import { ingestPivotRows, type PivotImportResult } from '../pivot/index';
import type { PivotIssue } from '../pivot/rows';
import { utcStringToMs } from '../time';

const ACTIVITY_TYPES = new Set(['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'LIABILITY']);

/** Table inverse id CoinGecko → code d'actif interne, dérivée une fois de la table curée des tickers. */
const COINGECKO_TO_CODE: Record<string, string> = {};
for (const [code, info] of Object.entries(TICKERS)) {
  if (info.coingeckoId !== null) COINGECKO_TO_CODE[info.coingeckoId] = code;
}

/** Suffixes de paire Yahoo Finance pour les cryptos (`BTC-USD`, `ETH-EUR`…). */
const YAHOO_SUFFIX = /-(?:EUR|USD|USDT|BTC|GBP)$/i;

/**
 * Code d'actif interne à partir du symbole Ghostfolio et de sa source de prix. Un slug CoinGecko
 * absent de la table curée est conservé tel quel (minuscules) : on ne perd jamais une opération
 * faute de ticker connu, mais une note prévient l'utilisateur (reportée dans la description).
 */
export function ghostfolioAsset(
  symbol: string,
  dataSource: string | null,
): { code: string; note: string | null } {
  const trimmed = symbol.trim();
  if (dataSource === 'COINGECKO') {
    const slug = trimmed.toLowerCase();
    const known = COINGECKO_TO_CODE[slug];
    return known !== undefined
      ? { code: known, note: null }
      : { code: slug, note: 'actif CoinGecko non répertorié' };
  }
  if (dataSource === 'YAHOO') {
    return { code: trimmed.replace(YAHOO_SUFFIX, '').toLowerCase(), note: null };
  }
  return { code: trimmed.toLowerCase(), note: null };
}

/** Nombre JSON Ghostfolio → chaîne décimale ; `null` si absent, non numérique ou négatif. */
function nonNegativeDecimal(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return String(value);
}

/** Chaîne non vide (espaces retirés) ; `null` sinon. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function importGhostfolioJson(
  text: string,
  existing: Record<RowKey, RawPivotRow>,
  accountId: AccountId,
  importId: string,
  usdRate: UsdRate,
  qualifications: Record<EventId, Qualification> = {},
): PivotImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ce fichier n'est pas un JSON valide.", details: [], header: [] };
  }

  const root = json !== null && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const rawActivities = root['activities'];
  if (!Array.isArray(rawActivities)) {
    return {
      ok: false,
      error: "Ce fichier ne contient pas d'activités Ghostfolio.",
      details: [
        'Un tableau « activities » est attendu (export complet, ou simplement { activities: [...] }).',
      ],
      header: [],
    };
  }

  const rawAccounts = root['accounts'];
  const accounts: Record<string, unknown>[] = Array.isArray(rawAccounts)
    ? rawAccounts.filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
    : [];
  const accountLabel = (ghostfolioAccountId: string | null): string | null => {
    if (ghostfolioAccountId === null) return null;
    const found = accounts.find((a) => a['id'] === ghostfolioAccountId);
    const name = found ? found['name'] : undefined;
    return typeof name === 'string' ? `Compte Ghostfolio : ${name}` : null;
  };

  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];
  let skippedInternal = 0;

  rawActivities.forEach((raw, index) => {
    const lineNo = index + 1;
    const activity =
      raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (activity === null) {
      issues.push({ lineNo, message: 'Activité illisible (un objet est attendu).' });
      return;
    }

    const rawType = activity['type'];
    const type = typeof rawType === 'string' ? rawType.toUpperCase() : '';
    if (!ACTIVITY_TYPES.has(type)) {
      issues.push({
        lineNo,
        message: `Type d'activité Ghostfolio inconnu « ${String(rawType)} ».`,
      });
      return;
    }

    const rawDate = activity['date'];
    const timeMs = typeof rawDate === 'string' ? utcStringToMs(rawDate) : null;
    if (timeMs === null) {
      issues.push({
        lineNo,
        message: `Date illisible « ${String(rawDate)} » (attendu ISO 8601 UTC).`,
      });
      return;
    }

    const quantity = nonNegativeDecimal(activity['quantity']);
    const unitPrice = nonNegativeDecimal(activity['unitPrice']);
    const fee = nonNegativeDecimal(activity['fee']);
    if (quantity === null || unitPrice === null || fee === null) {
      issues.push({
        lineNo,
        message: 'Quantité, prix unitaire ou frais illisible (nombre positif ou nul attendu).',
      });
      return;
    }

    const currency = normalizeAssetCode(nonEmptyString(activity['currency']) ?? '');
    const symbol = nonEmptyString(activity['symbol']) ?? '';
    const dataSource = nonEmptyString(activity['dataSource']);
    const comment = nonEmptyString(activity['comment']);
    const ghostfolioAccountId = nonEmptyString(activity['accountId']);
    const txHash = nonEmptyString(activity['id']);
    const value = D(quantity).times(unitPrice).toString();

    // Contenu natif stable : uniquement des champs bruts (ou normalisés à l'identique à chaque
    // ré-import), jamais `value` (calculé) — la clé pivot doit rester la même si le calcul évolue.
    const nativeContent = [
      rawDate,
      type,
      symbol,
      dataSource ?? '',
      quantity,
      unitPrice,
      fee,
      currency,
      ghostfolioAccountId ?? '',
      comment ?? '',
    ].join('|');

    const buildDescription = (assetNote: string | null): string | null => {
      const parts = [accountLabel(ghostfolioAccountId), comment, assetNote].filter(
        (p): p is string => p !== null,
      );
      return parts.length > 0 ? parts.join(' — ') : null;
    };

    const push = (
      draft: Pick<
        PlatformDraft,
        'sent' | 'received' | 'fee' | 'netWorth' | 'label' | 'description'
      >,
    ): void => {
      drafts.push({ lineNo, nativeContent, timeMs, txHash, ...draft });
    };

    switch (type) {
      case 'BUY': {
        const asset = ghostfolioAsset(symbol, dataSource);
        push({
          sent: { amount: value, currency },
          received: { amount: quantity, currency: asset.code },
          fee: D(fee).gt(ZERO) ? { amount: fee, currency } : null,
          netWorth: null,
          label: null,
          description: buildDescription(asset.note),
        });
        break;
      }
      case 'SELL': {
        const asset = ghostfolioAsset(symbol, dataSource);
        push({
          sent: { amount: quantity, currency: asset.code },
          received: { amount: value, currency },
          fee: D(fee).gt(ZERO) ? { amount: fee, currency } : null,
          netWorth: null,
          label: null,
          description: buildDescription(asset.note),
        });
        break;
      }
      case 'DIVIDEND':
      case 'INTEREST': {
        const label = type.toLowerCase();
        if (dataSource === 'COINGECKO' || dataSource === 'YAHOO') {
          const asset = ghostfolioAsset(symbol, dataSource);
          push({
            sent: null,
            received: { amount: quantity, currency: asset.code },
            fee: null,
            netWorth: { amount: value, currency },
            label,
            description: buildDescription(asset.note),
          });
        } else {
          // Revenu cash pur (MANUAL ou source absente) : ligne 100 % fiat, « ignorée cash » en aval
          // (aucun modèle de trésorerie hors opération dans le pipeline pivot) — documenté et voulu.
          push({
            sent: null,
            received: { amount: value, currency },
            fee: null,
            netWorth: null,
            label,
            description: buildDescription(null),
          });
        }
        break;
      }
      case 'FEE': {
        push({
          sent: { amount: D(value).plus(fee).toString(), currency },
          received: null,
          fee: null,
          netWorth: null,
          label: 'cost',
          description: buildDescription(null),
        });
        break;
      }
      case 'LIABILITY': {
        skippedInternal++;
        break;
      }
    }
  });

  const parsed = draftsToPivotRows(drafts, importId, accountId);
  return ingestPivotRows(
    { rows: parsed.rows, issues: [...issues, ...parsed.issues] },
    {
      format: 'ghostfolio-json',
      header: [],
      unknownColumns: [],
      totalRows: rawActivities.length,
      skippedInternal,
    },
    existing,
    accountId,
    usdRate,
    qualifications,
  );
}
