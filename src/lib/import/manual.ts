/** Saisie manuelle → événement du grand livre. */
import type { LedgerEvent, ManualEvent } from '../domain/types';

export function manualToLedgerEvent(m: ManualEvent): LedgerEvent {
  const base = {
    id: `man:${m.id}`,
    at: m.at,
    source: 'manual' as const,
    scope: m.scope,
    rowKeys: [] as string[],
    warnings: [] as string[],
  };
  const leg = { asset: m.asset, qty: m.qty };
  switch (m.kind) {
    case 'buy':
      return {
        ...base,
        kind: 'trade',
        out: { asset: 'eur', qty: m.amountEur ?? '0' },
        in: leg,
        valueEur: m.amountEur ?? '0',
        valueEurSource: 'manual',
        fee: null,
        quotePrice: null,
        warnings: m.amountEur ? [] : ['Montant EUR manquant : achat valorisé à 0 €.'],
      };
    case 'sell':
      return {
        ...base,
        kind: 'trade',
        out: leg,
        in: { asset: 'eur', qty: m.amountEur ?? '0' },
        valueEur: m.amountEur ?? '0',
        valueEurSource: 'manual',
        fee: null,
        quotePrice: null,
        warnings: m.amountEur ? [] : ['Montant EUR manquant : vente valorisée à 0 €.'],
      };
    case 'reward':
      return { ...base, kind: 'reward', in: leg, fairValueEur: m.amountEur };
    case 'deposit':
      return { ...base, kind: 'deposit', in: leg, costEur: m.amountEur };
    case 'withdrawal':
      return { ...base, kind: 'withdrawal', out: leg, proceedsEur: m.amountEur };
    case 'opening-balance':
      return { ...base, kind: 'opening-balance', in: leg, costEur: m.amountEur ?? '0' };
  }
}
