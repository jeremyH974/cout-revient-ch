/**
 * Auto-vérifications visibles par l'utilisateur : l'application contrôle ses propres chiffres
 * (invariant comptable, lots, soldes Coinhouse), l'état des prix et de la sauvegarde, et dit
 * quoi faire quand un voyant n'est pas vert. Module pur : aucun montant n'est formaté ici, les
 * détails ne contiennent que des compteurs et des tickers (compatibles avec le mode discret).
 */
import type { PortfolioReport, PositionReport, PriceQuoteInput } from '../domain/engine/report';
import type { AssetCode } from '../domain/types';

export type CheckLevel = 'ok' | 'warn' | 'fail' | 'info';

export interface SelfCheck {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
  /** Conseil d'action quand le voyant n'est pas vert. */
  action?: string;
}

export interface SelfCheckInput {
  report: PortfolioReport | null;
  quotes: Record<AssetCode, PriceQuoteInput>;
  prices: {
    source: 'auto' | 'off';
    online: boolean | null;
    lastRefreshAt: string | null;
  };
  storage: {
    lastBackupAt: string | null;
    persisted: boolean | null;
    saveError: string | null;
  };
  /** ISO 8601. */
  now: string;
}

const TOLERANCE = '0.000001';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const allPositions = (r: PortfolioReport): PositionReport[] => [
  ...r.positions,
  ...r.stablecoins,
  ...r.closed,
];

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
const tickers = (assets: readonly string[]): string =>
  assets.map((a) => a.toUpperCase()).join(', ');

function ageDays(iso: string, now: string): number {
  return (new Date(now).getTime() - new Date(iso).getTime()) / DAY_MS;
}

export function runSelfChecks(input: SelfCheckInput): SelfCheck[] {
  const checks: SelfCheck[] = [];
  const { report } = input;

  if (!report) {
    checks.push({
      id: 'data',
      label: 'Données',
      level: 'info',
      detail: 'Aucune donnée importée pour le moment.',
    });
  } else {
    // 1. Invariant comptable, actif par actif : total = valeur + Σ produits − Σ achats.
    const priced = allPositions(report).filter((p) => p.total !== null && p.value !== null);
    const broken = priced.filter(
      (p) =>
        !p.total!.minus(p.value!.plus(p.proceedsTotal).minus(p.investedTotal)).abs().lte(TOLERANCE),
    );
    checks.push(
      broken.length === 0
        ? {
            id: 'invariant',
            label: 'Cohérence comptable',
            level: 'ok',
            detail: `${plural(priced.length, 'actif vérifié', 'actifs vérifiés')} : total = valeur + produits − achats.`,
          }
        : {
            id: 'invariant',
            label: 'Cohérence comptable',
            level: 'fail',
            detail: `Écart sur ${tickers(broken.map((p) => p.asset))}.`,
            action:
              'Signalez-le avec le diagnostic : c’est une erreur de calcul, pas de vos données.',
          },
    );

    // 2. Lots ↔ position : la somme des lots restants doit redonner la quantité et le coût.
    const open = [...report.positions, ...report.stablecoins].filter((p) => p.lots.length > 0);
    const lotBroken = open.filter((p) => {
      const qty = p.lots.reduce((acc, l) => acc.plus(l.qtyRemaining), p.qty.minus(p.qty));
      const cost = p.lots.reduce(
        (acc, l) => acc.plus(l.costRemaining),
        p.costBasis.minus(p.costBasis),
      );
      return (
        !qty.minus(p.qty).abs().lte(TOLERANCE) || !cost.minus(p.costBasis).abs().lte(TOLERANCE)
      );
    });
    checks.push(
      lotBroken.length === 0
        ? {
            id: 'lots',
            label: 'Lots et PRU',
            level: 'ok',
            detail: `Les lots de ${plural(open.length, 'position', 'positions')} redonnent exactement quantité et coût.`,
          }
        : {
            id: 'lots',
            label: 'Lots et PRU',
            level: 'fail',
            detail: `Lots incohérents sur ${tickers(lotBroken.map((p) => p.asset))}.`,
            action: 'Signalez-le avec le diagnostic.',
          },
    );

    // 3. Soldes Coinhouse : la colonne « Solde » de l'export doit être retrouvée après chaque opération.
    const checked = [...allPositions(report), ...report.blocked].filter(
      (p) => p.integrity !== null,
    );
    const mismatch = checked.filter(
      (p) => p.integrity!.status === 'balance-mismatch' || p.integrity!.status === 'final-mismatch',
    );
    const opening = checked.filter((p) => p.integrity!.status === 'opening-balance-missing');
    if (mismatch.length > 0) {
      checks.push({
        id: 'balances',
        label: 'Soldes Coinhouse',
        level: 'fail',
        detail: `Écart de solde sur ${tickers(mismatch.map((p) => p.asset))}.`,
        action:
          'Réimportez un export complet (toutes périodes). Si l’écart persiste, signalez-le : une ligne est peut-être mal interprétée.',
      });
    } else if (opening.length > 0) {
      checks.push({
        id: 'balances',
        label: 'Soldes Coinhouse',
        level: 'warn',
        detail: `Export incomplet pour ${tickers(opening.map((p) => p.asset))} : des opérations antérieures manquent.`,
        action:
          'Réimportez un export couvrant toute la période, ou saisissez un solde d’ouverture.',
      });
    } else {
      checks.push({
        id: 'balances',
        label: 'Soldes Coinhouse',
        level: checked.length > 0 ? 'ok' : 'info',
        detail:
          checked.length > 0
            ? `${plural(checked.length, 'actif', 'actifs')} : soldes de l’export retrouvés après chaque opération.`
            : 'Aucun solde à vérifier (saisies manuelles).',
      });
    }

    // 4. Opérations non interprétées et historiques incomplets.
    if (report.blocked.length > 0) {
      checks.push({
        id: 'blocked',
        label: 'Historique d’achat',
        level: 'fail',
        detail: `Cession sans achat connu sur ${tickers(report.blocked.map((p) => p.asset))} : calcul impossible.`,
        action: 'Réimportez un export plus ancien ou saisissez les achats manquants.',
      });
    }
    if (report.unqualified.length > 0) {
      checks.push({
        id: 'unqualified',
        label: 'Opérations à qualifier',
        level: 'warn',
        detail: `${plural(report.unqualified.length, 'opération', 'opérations')} d’un type inconnu (${[...new Set(report.unqualified.map((u) => u.rawType))].join(', ')}).`,
        action:
          'Qualifiez-les depuis le portefeuille (bouton « Qualifier ») ; signalez le libellé via le diagnostic s’il revient souvent.',
      });
    } else {
      checks.push({
        id: 'unqualified',
        label: 'Opérations à qualifier',
        level: 'ok',
        detail: 'Toutes les opérations de l’export sont interprétées.',
      });
    }

    // 5. Prix : manquants, périmés, anciens.
    const held = [...report.positions, ...report.stablecoins].map((p) => p.asset);
    if (input.prices.source === 'off') {
      checks.push({
        id: 'prices',
        label: 'Prix',
        level: 'info',
        detail: 'Prix automatiques désactivés : le latent dépend des prix manuels.',
      });
    } else {
      const missing = report.totals.unpricedAssets;
      const stale = held.filter((a) => input.quotes[a]?.stale);
      const refreshedAgo =
        input.prices.lastRefreshAt === null
          ? null
          : new Date(input.now).getTime() - new Date(input.prices.lastRefreshAt).getTime();
      if (missing.length > 0) {
        checks.push({
          id: 'prices',
          label: 'Prix',
          level: 'warn',
          detail: `Pas de prix pour ${tickers(missing)} : exclus de la valeur et du latent.`,
          action: 'Saisissez un prix manuel sur la fiche de l’actif, ou réessayez plus tard.',
        });
      } else if (stale.length > 0 || input.prices.online === false) {
        checks.push({
          id: 'prices',
          label: 'Prix',
          level: 'warn',
          detail:
            stale.length > 0
              ? `Prix en cache (hors ligne) pour ${tickers(stale)}.`
              : 'Hors ligne : les derniers prix connus sont utilisés.',
          action: 'Actualisez les prix quand la connexion revient.',
        });
      } else if (refreshedAgo !== null && refreshedAgo > HOUR_MS) {
        checks.push({
          id: 'prices',
          label: 'Prix',
          level: 'warn',
          detail: `Dernière actualisation il y a plus de ${Math.floor(refreshedAgo / HOUR_MS)} h.`,
          action: 'Actualisez les prix (bouton en haut à droite).',
        });
      } else {
        checks.push({
          id: 'prices',
          label: 'Prix',
          level: 'ok',
          detail:
            held.length > 0
              ? `${plural(held.length, 'actif valorisé', 'actifs valorisés')}, prix à jour.`
              : 'Aucune position ouverte à valoriser.',
        });
      }
    }
  }

  // 6. Sauvegarde et stockage.
  if (input.storage.saveError) {
    checks.push({
      id: 'backup',
      label: 'Sauvegarde',
      level: 'fail',
      detail: 'L’enregistrement local échoue : vos modifications ne sont pas conservées.',
      action:
        'Téléchargez une sauvegarde JSON maintenant et libérez de l’espace dans le navigateur.',
    });
  } else if (input.storage.lastBackupAt === null) {
    checks.push({
      id: 'backup',
      label: 'Sauvegarde',
      level: report ? 'warn' : 'info',
      detail: 'Aucune sauvegarde JSON téléchargée : vos données ne vivent que dans ce navigateur.',
      action: 'Réglages → Données → Télécharger une sauvegarde (JSON).',
    });
  } else if (ageDays(input.storage.lastBackupAt, input.now) > 30) {
    checks.push({
      id: 'backup',
      label: 'Sauvegarde',
      level: 'warn',
      detail: `Dernière sauvegarde il y a ${Math.floor(ageDays(input.storage.lastBackupAt, input.now))} jours.`,
      action: 'Téléchargez une nouvelle sauvegarde après chaque import.',
    });
  } else {
    checks.push({
      id: 'backup',
      label: 'Sauvegarde',
      level: 'ok',
      detail: `Sauvegarde récente${input.storage.persisted === false ? ' (stockage non garanti par le navigateur : gardez-la précieusement)' : ''}.`,
    });
  }

  return checks;
}

export function summarize(checks: readonly SelfCheck[]): {
  ok: number;
  total: number;
  worst: CheckLevel;
} {
  const rank: Record<CheckLevel, number> = { ok: 0, info: 1, warn: 2, fail: 3 };
  const worst = checks.reduce<CheckLevel>(
    (acc, c) => (rank[c.level] > rank[acc] ? c.level : acc),
    'ok',
  );
  return { ok: checks.filter((c) => c.level === 'ok').length, total: checks.length, worst };
}
