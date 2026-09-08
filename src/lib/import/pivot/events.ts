/**
 * Lignes pivot → événements du grand livre Investissement. Mêmes règles de valeur que le reste de
 * l'app : contre-jambe EUR directe, USD et stables USD convertis au taux BCE du jour (décision
 * n° 18), stables EUR au pair ; jamais d'estimation silencieuse — sans contre-valeur sûre, la
 * ligne part dans le flux « à qualifier ». Dépôts/retraits crypto restent sans valeur : ce sont
 * les candidats de l'appariement de virements (décision n° 25).
 */
import { fiatEquivalent, isFiat } from '../../domain/assets';
import { D, ZERO, toDecimalString, type Big } from '../../domain/money';
import type {
  EventId,
  LedgerEvent,
  PivotAmount,
  Qualification,
  RawPivotRow,
  TradeFee,
  UnqualifiedEvent,
  UnqualifiedLeg,
} from '../../domain/types';
import { applyQualification } from '../coinhouse/qualify';

/*
 * Les quatre tables d'étiquettes sont EXPORTÉES depuis P64 : l'appariement assisté y traduit les
 * libellés de type d'un fichier inconnu (« Récompense », « Staking-Reward », « Frais de retrait »)
 * vers les étiquettes que ce module lit déjà. Elles restent la seule source de vérité — une table
 * recopiée dans le module d'appariement aurait divergé au premier ajout d'étiquette, et la
 * divergence se serait vue non pas à la lecture, mais dans un montant.
 */

/** Étiquettes Koinly traitées comme un revenu (entrée sans contrepartie, juste valeur). */
export const REWARD_LABELS = new Set([
  'reward',
  'staking',
  'stake',
  'airdrop',
  'fork',
  'mining',
  'dividend',
  'interest',
  'lending interest',
  'salary',
  'income',
  'cashback',
  'fee refund',
]);

/** Étiquettes « frais » : une sortie fiat seule devient un frais hors opération. */
export const FEE_LABELS = new Set([
  'cost',
  'fee',
  'tax',
  'margin fee',
  'loan fee',
  'other fee',
  'futures fee',
  'funding fee',
]);

/** Étiquettes de sortie « sans plus-value » chez Koinly : sortie au coût, annotée. */
export const NEUTRAL_OUT_LABELS = new Set(['gift', 'lost', 'donation']);

/** Étiquettes de DÉPENSE (paiement carte, débit) : cession réalisée à la contre-valeur fournie. */
export const SPEND_LABELS = new Set(['spend', 'card spend', 'payment']);

export type UsdRate = (day: string) => string | null;

/** Valeur EUR d'un montant « cash » (EUR, USD, stables) au jour donné ; null sinon. */
function eurValue(amount: PivotAmount, day: string, usdRate: UsdRate): Big | null {
  const kind = fiatEquivalent(amount.currency);
  if (kind === 'eur') return D(amount.amount);
  if (kind === 'usd') {
    const rate = usdRate(day);
    return rate === null || !D(rate).gt(ZERO) ? null : D(amount.amount).div(rate);
  }
  return null;
}

const cashish = (amount: PivotAmount): boolean =>
  fiatEquivalent(amount.currency) !== null || isFiat(amount.currency);

export interface PivotNormalization {
  events: LedgerEvent[];
  /** Lignes 100 % fiat ignorées (pas de modèle de trésorerie hors opérations). */
  skippedCash: number;
}

export function pivotLedgerEvents(
  rows: readonly RawPivotRow[],
  qualifications: Record<EventId, Qualification>,
  usdRate: UsdRate,
): PivotNormalization {
  const events: LedgerEvent[] = [];
  let skippedCash = 0;
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
  for (const row of sorted) {
    const built = buildEvent(row, usdRate);
    if (built === null) {
      skippedCash++;
      continue;
    }
    if (built.kind === 'unqualified') {
      const q = qualifications[built.id];
      if (q) {
        const qualified = applyQualification(built, q);
        if (qualified) events.push(qualified);
        continue;
      }
    }
    events.push(built);
  }
  return { events, skippedCash };
}

function unqualified(row: RawPivotRow, reason: string): UnqualifiedEvent {
  const legs: UnqualifiedLeg[] = [];
  if (row.sent)
    legs.push({
      asset: row.sent.currency,
      signedQty: toDecimalString(D(row.sent.amount).neg()),
      valueEur: null,
    });
  if (row.received)
    legs.push({ asset: row.received.currency, signedQty: row.received.amount, valueEur: null });
  return {
    id: row.key,
    at: row.at,
    source: 'pivot-csv',
    scope: 'external',
    accountId: row.accountId,
    rowKeys: [row.key],
    warnings: [],
    kind: 'unqualified',
    rawType: row.label ?? (row.sent && row.received ? 'échange' : row.sent ? 'envoi' : 'réception'),
    legs,
    reason,
  };
}

/** `null` = ligne 100 % fiat, hors modèle (comptée « ignorée »). */
function buildEvent(row: RawPivotRow, usdRate: UsdRate): LedgerEvent | null {
  // Action de société : ni jambe envoyée ni jambe reçue, rien à valoriser. Elle passe avant
  // tout le reste, car la suite suppose partout qu'une ligne porte un montant.
  const base = {
    id: row.key,
    at: row.at,
    source: 'pivot-csv' as const,
    scope: 'external' as const,
    accountId: row.accountId,
    rowKeys: [row.key],
    warnings: [] as string[],
  };
  const corporate = row.corporateAction;
  if (corporate) {
    return { ...base, kind: 'split', asset: corporate.asset, ratio: corporate.ratio };
  }
  const day = row.at.slice(0, 10);
  const sides = [row.sent, row.received].filter((s): s is PivotAmount => s !== null);
  const feeLabelled = row.sent !== null && row.received === null && FEE_LABELS.has(row.label ?? '');
  /**
   * **Revenu en espèces**, entrée seule étiquetée comme telle : dividende, intérêts, remise.
   *
   * Sans ce cas, la ligne tombait dans le filtre « 100 % fiat » ci-dessous et **disparaissait dans
   * un compteur** — c'est ce qui a laissé 64 dividendes hors du modèle (décision n° 132). Le
   * symétrique existait déjà pour les frais ; il manquait du côté des revenus.
   */
  const incomeLabelled =
    row.received !== null && row.sent === null && REWARD_LABELS.has(row.label ?? '');
  // Lignes 100 % fiat hors modèle (dépôt/retrait d'euros…), SAUF une sortie étiquetée « frais »
  // ou une entrée étiquetée « revenu ».
  if (!feeLabelled && !incomeLabelled && sides.length > 0 && sides.every((s) => isFiat(s.currency)))
    return null;

  if (incomeLabelled && row.received && isFiat(row.received.currency)) {
    const gross = eurValue(row.received, day, usdRate);
    if (gross === null) {
      return unqualified(
        row,
        `Revenu en ${row.received.currency} non converti (taux BCE indisponible à cette date).`,
      );
    }
    const withheld = row.withheld ? eurValue(row.withheld, day, usdRate) : null;
    if (row.withheld && withheld === null) {
      base.warnings.push(
        `Retenue à la source en ${row.withheld.currency} non convertie : le brut est compté sans elle.`,
      );
    }
    return {
      ...base,
      kind: 'income',
      // Le pivot ne sait pas à quelle ligne un revenu appartient : seul un convertisseur de
      // plateforme le sait, et il le dira par `description`. Ici, le revenu est au compte.
      asset: null,
      grossEur: toDecimalString(gross),
      withheldEur: withheld === null ? '0' : toDecimalString(withheld),
      nature: (row.label ?? '') === 'dividend' ? 'dividend' : 'interest',
      label: row.description ?? row.label ?? 'Revenu',
    };
  }

  const feeValue = row.fee ? eurValue(row.fee, day, usdRate) : null;
  const fee = (): TradeFee | null => {
    if (!row.fee) return null;
    if (feeValue === null) {
      base.warnings.push(
        `Frais en ${row.fee.currency} non convertis : ils ne sont ni déduits ni comptés.`,
      );
      return null;
    }
    return {
      asset: row.fee.currency,
      gross: row.fee.amount,
      rebate: '0',
      grossEur: toDecimalString(feeValue),
      rebateEur: '0',
    };
  };

  // --- Échange (deux jambes) --------------------------------------------------------------------
  if (row.sent && row.received) {
    const sentCash = cashish(row.sent);
    const receivedCash = cashish(row.received);
    let value: Big | null = null;
    let feeSign = 0;
    if (receivedCash && (!sentCash || fiatEquivalent(row.received.currency) === 'eur')) {
      // Vente (ou cash → cash) : la contre-jambe est ce qui est reçu, produit net de frais.
      value = eurValue(row.received, day, usdRate);
      feeSign = -1;
    } else if (sentCash) {
      // Achat : la contre-jambe est ce qui est payé, coût all-in frais compris.
      value = eurValue(row.sent, day, usdRate);
      feeSign = +1;
    }
    if (value === null && row.netWorth) {
      value = eurValue(row.netWorth, day, usdRate);
      feeSign = 0;
      if (value !== null)
        base.warnings.push('Contre-valeur issue de la colonne Net Worth du fichier.');
    }
    if (value === null) {
      const cashSide = sentCash || receivedCash;
      return unqualified(
        row,
        cashSide
          ? `Contre-valeur en ${(sentCash ? row.sent : row.received).currency} non convertie (taux BCE indisponible à cette date ou devise non gérée).`
          : 'Contre-valeur EUR inconnue : renseignez Net Worth dans le fichier ou qualifiez la ligne.',
      );
    }
    const tradeFee = fee();
    if (tradeFee && feeSign !== 0) {
      const adjusted = feeSign > 0 ? value.plus(tradeFee.grossEur) : value.minus(tradeFee.grossEur);
      value = adjusted.gt(ZERO) ? adjusted : ZERO;
    }
    return {
      ...base,
      kind: 'trade',
      out: { asset: row.sent.currency, qty: row.sent.amount },
      in: { asset: row.received.currency, qty: row.received.amount },
      valueEur: toDecimalString(value),
      valueEurSource: 'counter-leg',
      fee: tradeFee,
      quotePrice: null,
    };
  }

  // --- Réception seule --------------------------------------------------------------------------
  if (row.received) {
    const label = row.label ?? '';
    if (REWARD_LABELS.has(label)) {
      const fair = row.netWorth ? eurValue(row.netWorth, day, usdRate) : null;
      if (fair === null) base.warnings.push('Récompense sans contre-valeur connue : 0 € retenu.');
      return {
        ...base,
        kind: 'reward',
        in: { asset: row.received.currency, qty: row.received.amount },
        fairValueEur: fair === null ? null : toDecimalString(fair),
      };
    }
    // Dépôt d'un « cash » (stablecoin, USD…) : coût déterministe, pas un virement à apparier.
    const auto = cashish(row.received) ? eurValue(row.received, day, usdRate) : null;
    if (auto !== null)
      base.warnings.push('Dépôt de stablecoin valorisé au taux BCE du jour de réception.');
    return {
      ...base,
      kind: 'deposit',
      in: { asset: row.received.currency, qty: row.received.amount },
      costEur: auto === null ? null : toDecimalString(auto),
    };
  }

  // --- Envoi seul -------------------------------------------------------------------------------
  const sent = row.sent!;
  const label = row.label ?? '';
  if (FEE_LABELS.has(label)) {
    const value = eurValue(sent, day, usdRate);
    if (value !== null) {
      return {
        ...base,
        kind: 'fee',
        amountEur: toDecimalString(value),
        label: row.label ?? 'frais',
      };
    }
    base.warnings.push(`Étiquette « ${label} » sur une sortie non convertible : sortie au coût.`);
  }
  if (SPEND_LABELS.has(label)) {
    const spent = row.netWorth ? eurValue(row.netWorth, day, usdRate) : null;
    if (spent !== null) {
      base.warnings.push('Dépense : cession réalisée à la contre-valeur du relevé.');
      return {
        ...base,
        kind: 'withdrawal',
        out: { asset: sent.currency, qty: sent.amount },
        proceedsEur: toDecimalString(spent),
      };
    }
    base.warnings.push('Dépense sans contre-valeur convertible : sortie au coût.');
  }
  if (NEUTRAL_OUT_LABELS.has(label)) {
    base.warnings.push(`Étiquette « ${label} » : sortie au coût, aucune plus-value constatée.`);
  }
  const auto = cashish(sent) ? eurValue(sent, day, usdRate) : null;
  if (auto !== null) base.warnings.push('Retrait de stablecoin valorisé au taux BCE du jour.');
  return {
    ...base,
    kind: 'withdrawal',
    out: { asset: sent.currency, qty: sent.amount },
    proceedsEur: auto === null ? null : toDecimalString(auto),
  };
}
