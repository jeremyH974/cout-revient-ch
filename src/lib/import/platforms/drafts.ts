/**
 * Brouillons de convertisseur → lignes pivot stockables. La clé `pv:<compte>:<fnv1a(natif)>[#n]`
 * hache le contenu NATIF : stable si le convertisseur évolue (même clé → la ligne est mise à jour
 * ou signalée en conflit, jamais dupliquée). Deux lignes natives identiques restent distinctes
 * (suffixe `#n` déterministe, comme le pipeline pivot).
 */
import { normalizeAssetCode } from '../../domain/assets';
import { D, ZERO } from '../../domain/money';
import type { AccountId, PivotAmount, RawPivotRow } from '../../domain/types';
import { msToParisNaive, msToUtcString } from '../time';
import { fnv1a, type ParsedPivotRows, type PivotIssue } from '../pivot/rows';
import type { PlatformDraft } from './types';

function cleanAmount(
  amount: PivotAmount | null,
  what: string,
  issues: string[],
): PivotAmount | null {
  if (amount === null) return null;
  try {
    const abs = D(amount.amount).abs();
    if (abs.eq(ZERO)) return null;
    return { amount: abs.toString(), currency: normalizeAssetCode(amount.currency) };
  } catch {
    issues.push(`${what} : montant illisible « ${amount.amount} ».`);
    return null;
  }
}

export function draftsToPivotRows(
  drafts: readonly PlatformDraft[],
  importId: string,
  accountId: AccountId,
): ParsedPivotRows {
  const rows: RawPivotRow[] = [];
  const issues: PivotIssue[] = [];
  const seen = new Map<string, number>();
  for (const draft of drafts) {
    const localIssues: string[] = [];
    const sent = cleanAmount(draft.sent, 'Envoyé', localIssues);
    const received = cleanAmount(draft.received, 'Reçu', localIssues);
    const fee = cleanAmount(draft.fee, 'Frais', localIssues);
    const netWorth = cleanAmount(draft.netWorth, 'Contre-valeur', localIssues);
    if (localIssues.length > 0) {
      issues.push({ lineNo: draft.lineNo, message: localIssues.join(' ') });
      continue;
    }
    if (sent === null && received === null) {
      issues.push({
        lineNo: draft.lineNo,
        message: 'Ligne sans montant envoyé ni reçu : ignorée.',
      });
      continue;
    }
    const hash = fnv1a(draft.nativeContent);
    const occurrence = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, occurrence);
    const key = `pv:${accountId}:${hash}${occurrence > 1 ? `#${occurrence}` : ''}`;
    const label = (draft.label ?? '').trim().toLowerCase();
    const description = (draft.description ?? '').trim();
    const txHash = (draft.txHash ?? '').trim();
    rows.push({
      key,
      importId,
      lineNo: draft.lineNo,
      accountId,
      date: msToUtcString(draft.timeMs),
      at: msToParisNaive(draft.timeMs),
      sent,
      received,
      fee,
      netWorth,
      label: label === '' ? null : label,
      description: description === '' ? null : description,
      txHash: txHash === '' ? null : txHash,
    });
  }
  return { rows, issues };
}
