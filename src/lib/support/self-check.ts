/**
 * Auto-vérifications visibles par l'utilisateur : l'application contrôle ses propres chiffres
 * (invariant comptable, lots, soldes Coinhouse), l'état des prix et de la sauvegarde, et dit
 * quoi faire quand un voyant n'est pas vert. Module pur : aucun montant n'est formaté ici, les
 * détails ne contiennent que des compteurs et des tickers (compatibles avec le mode discret).
 */
import type { PortfolioReport, PositionReport, PriceQuoteInput } from '../domain/engine/report';
import type { NetWorthReconciliation } from '../history/net-worth';
import { D, ZERO, type Big } from '../domain/money';
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
    /**
     * Échec du **miroir** `localStorage` alors que l'enregistrement a réussi (décision n° 79).
     * Non bloquant : rien n'est perdu tant qu'IndexedDB répond — mais le repli, lui, ne serait plus
     * à jour le jour où il servirait.
     */
    mirrorError?: string | null;
  };
  /** Plateforme (facultatif) : iPhone/iPad non installé = données effaçables par Safari après 7 jours. */
  platform?: { ios: boolean; standalone: boolean };
  /** Comptes de trading (Hyperliquid) : réconciliation d'équité et fraîcheur de synchronisation. */
  trading?: TradingCheckInput[];
  /** Virements internes (décision n° 25) : paires appariées et candidats restés orphelins. */
  transfers?: { pairs: number; unpairedWithdrawals: number; unpairedDeposits: number };
  /**
   * Réconciliation du patrimoine (décision n° 55) : `apports nets + résultat = patrimoine`, avec
   * le détail par espace. `null` tant que l'historique des prix n'est pas chargé.
   */
  reconciliation?: NetWorthReconciliation | null;
  /** ISO 8601. */
  now: string;
}

export interface TradingCheckInput {
  label: string;
  /** `accountValue − (flux + réalisé − frais + funding + latent)` ; `null` sans instantané. */
  gap: Big | null;
  lastSyncAt: string | null;
  syncError: string | null;
  unknownLedgerTypes: string[];
  fxMissing: number;
}

/** Tolérance de réconciliation d'un compte perps (USDC) : arrondis de la plateforme. */
const TRADING_TOLERANCE = '0.01';

const TOLERANCE = '0.000001';
/**
 * Tolérance de la réconciliation du patrimoine : un centime. La série quotidienne et le rapport
 * atteignent le cours du jour par deux chemins différents ; exiger l'égalité stricte ferait
 * clignoter un voyant rouge pour un arrondi, ce qui apprendrait à l'ignorer.
 */
const RECONCILIATION_TOLERANCE = D('0.01');
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

    // 1 bis. Flux de trésorerie (base du XIRR) : décomposition exacte de Σ achats / Σ produits.
    // Sans position bloquée seulement : une position bloquée sort des totaux mais pas des flux.
    if (report.blocked.length === 0) {
      let negative = ZERO;
      let positive = ZERO;
      for (const flow of report.cashFlows) {
        if (flow.amountEur.lt(ZERO)) negative = negative.plus(flow.amountEur);
        else positive = positive.plus(flow.amountEur);
      }
      const investedSide = report.totals.investedTotal.plus(report.totals.subscriptionsEur);
      const flowsOk =
        negative.neg().minus(investedSide).abs().lte(TOLERANCE) &&
        positive.minus(report.totals.proceedsTotal).abs().lte(TOLERANCE);
      checks.push(
        flowsOk
          ? {
              id: 'cashflows',
              label: 'Flux datés (XIRR)',
              level: 'ok',
              detail: `${plural(report.cashFlows.length, 'flux vérifié', 'flux vérifiés')} : ils redonnent exactement Σ achats (+ abonnements) et Σ produits.`,
            }
          : {
              id: 'cashflows',
              label: 'Flux datés (XIRR)',
              level: 'fail',
              detail: 'Les flux datés ne redonnent pas Σ achats / Σ produits.',
              action:
                'Signalez-le avec le diagnostic : c’est une erreur de calcul, pas de vos données.',
            },
      );
    }

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
          action: 'Actualisez les prix (bouton « Actualiser » de la synthèse ou en haut à droite).',
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

  /*
   * Le repli est hors service, mais l'enregistrement fonctionne (décision n° 79).
   *
   * Voyant distinct de « Sauvegarde », et volontairement `warn` : annoncer une perte qui n'a pas eu
   * lieu serait le symétrique du silence qu'on corrige, et un garde-fou qui crie au loup finit
   * ignoré (décisions n° 72 et 74). Rendu **seulement** si l'enregistrement va bien : quand les deux
   * échouent, le voyant `fail` ci-dessous dit déjà tout, et deux alertes pour une même panne
   * diluent l'information.
   */
  if (input.storage.mirrorError && !input.storage.saveError) {
    checks.push({
      id: 'mirror',
      label: 'Copie de secours',
      level: 'warn',
      detail:
        'Vos données sont bien enregistrées, mais la copie de secours du navigateur n’est plus mise à jour (espace insuffisant).',
      action:
        'Téléchargez une sauvegarde JSON : c’est la seule copie qui ne dépende ni du navigateur ni de son quota.',
    });
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

  // iPhone/iPad : Safari efface le stockage d'un site non installé après 7 jours sans visite
  // (WebKit, ITP) ; une app ajoutée à l'écran d'accueil a son propre compteur et n'est pas purgée.
  if (report && input.platform?.ios && !input.platform.standalone) {
    checks.push({
      id: 'install',
      label: 'iPhone / iPad',
      level: 'warn',
      detail: 'Safari peut effacer les données d’un site non installé après 7 jours sans visite.',
      action:
        'Partagez → « Sur l’écran d’accueil » pour installer l’app, et gardez une sauvegarde dans Fichiers.',
    });
  }

  // 7. Trading : chaque compte Hyperliquid doit se réconcilier avec son instantané.
  for (const account of input.trading ?? []) {
    const id = `trading:${account.label}`;
    if (account.syncError) {
      checks.push({
        id,
        label: `Trading · ${account.label}`,
        level: 'warn',
        detail: 'La dernière synchronisation s’est interrompue : historique peut-être incomplet.',
        action: 'Relancez « Actualiser » dans l’espace Trading.',
      });
    } else if (account.gap === null) {
      checks.push({
        id,
        label: `Trading · ${account.label}`,
        level: 'info',
        detail: 'Pas encore synchronisé.',
        action: 'Lancez « Actualiser » dans l’espace Trading.',
      });
    } else if (!account.gap.abs().lte(TRADING_TOLERANCE)) {
      checks.push({
        id,
        label: `Trading · ${account.label}`,
        level: 'warn',
        detail: `Équité et historique ne se recoupent pas${account.unknownLedgerTypes.length > 0 ? ` (mouvements non interprétés : ${account.unknownLedgerTypes.join(', ')})` : ''}.`,
        action:
          'Relancez une synchronisation ; si l’écart persiste, signalez-le avec le diagnostic.',
      });
    } else if (account.lastSyncAt && ageDays(account.lastSyncAt, input.now) > 7) {
      checks.push({
        id,
        label: `Trading · ${account.label}`,
        level: 'info',
        detail: `Dernière synchronisation il y a ${Math.floor(ageDays(account.lastSyncAt, input.now))} jours.`,
        action: 'Lancez « Actualiser » dans l’espace Trading.',
      });
    } else {
      checks.push({
        id,
        label: `Trading · ${account.label}`,
        level: 'ok',
        detail: 'Équité = dépôts nets + réalisé − frais + funding + latent.',
      });
    }
    if (account.fxMissing > 0) {
      checks.push({
        id: `${id}:fx`,
        label: `Trading · ${account.label}`,
        level: 'warn',
        detail: `${plural(account.fxMissing, 'fill spot non converti', 'fills spot non convertis')} en euros (taux BCE indisponible).`,
        action:
          'Revenez en ligne et relancez « Actualiser » : les opérations spot seront intégrées.',
      });
    }
  }

  // Virements internes entre comptes : appariés = coût qui voyage ; orphelins = valeur à
  // renseigner (sinon retrait au coût / dépôt à 0 €, déjà signalés ligne à ligne).
  const transfers = input.transfers;
  if (
    transfers &&
    (transfers.pairs > 0 || transfers.unpairedWithdrawals > 0 || transfers.unpairedDeposits > 0)
  ) {
    const orphans = transfers.unpairedWithdrawals + transfers.unpairedDeposits;
    checks.push(
      orphans === 0
        ? {
            id: 'transfers',
            label: 'Virements internes',
            level: 'ok',
            detail: `${plural(transfers.pairs, 'virement apparié', 'virements appariés')} : le coût d'acquisition voyage entre vos comptes, aucune plus-value fantôme.`,
          }
        : {
            id: 'transfers',
            label: 'Virements internes',
            level: 'warn',
            detail: `${plural(orphans, 'mouvement sans contrepartie appariée', 'mouvements sans contrepartie appariée')} (${transfers.unpairedWithdrawals} retrait(s), ${transfers.unpairedDeposits} dépôt(s)) : appariez-les depuis Comptes ou renseignez leur valeur${transfers.pairs > 0 ? ` ; ${plural(transfers.pairs, 'virement apparié', 'virements appariés')}` : ''}.`,
          },
    );
  }

  // Réconciliation du patrimoine : le tableau de bord annonce « apports nets + résultat =
  // patrimoine » et le déplie espace par espace. Deux choses doivent tenir, et elles sont
  // vérifiées ici plutôt que promises dans une documentation.
  const recon = input.reconciliation;
  if (recon && report) {
    // 1. La somme des parts refait le tout. Vrai par construction — donc un écart signale une
    //    régression du calcul, jamais une donnée bancale : c'est un échec, pas un avertissement.
    const sumValue = recon.lines.reduce((acc, l) => acc.plus(l.value), ZERO);
    const sumContributed = recon.lines.reduce((acc, l) => acc.plus(l.contributed), ZERO);
    const partsGap = sumValue
      .minus(recon.net)
      .abs()
      .plus(sumContributed.minus(recon.contributed).abs());
    checks.push(
      partsGap.lte(TOLERANCE)
        ? {
            id: 'net-worth-parts',
            label: 'Patrimoine · détail',
            level: 'ok',
            detail: `${plural(recon.lines.length, 'espace recoupé', 'espaces recoupés')} : le détail par espace refait le total.`,
          }
        : {
            id: 'net-worth-parts',
            label: 'Patrimoine · détail',
            level: 'fail',
            detail: 'Le détail par espace ne refait pas le total affiché.',
            action:
              'Signalez-le avec le diagnostic : c’est une erreur de calcul, pas de vos données.',
          },
    );

    // 2. Le résultat de l'espace Investissement doit valoir « réalisé + latent » du moteur. C'est
    //    le contrôle qui tient toute la carte : il relie les apports nets — une notion de flux —
    //    aux plus-values calculées lot par lot, par un tout autre chemin. Tolérance au centime :
    //    la série quotidienne et le rapport lisent le cours du jour par deux voies distinctes.
    const invest = recon.lines.find((l) => l.id === 'invest');
    const engineResult =
      report.totals.unrealized === null
        ? null
        : report.totals.unrealized.plus(report.totals.realized);
    if (invest && !invest.unavailable && engineResult !== null) {
      const gap = invest.gain.minus(engineResult).abs();
      checks.push(
        gap.lte(RECONCILIATION_TOLERANCE)
          ? {
              id: 'net-worth-invest',
              label: 'Patrimoine · investissement',
              level: 'ok',
              detail:
                'Le résultat déduit des apports égale « réalisé + latent » calculé lot par lot.',
            }
          : {
              id: 'net-worth-invest',
              label: 'Patrimoine · investissement',
              level: 'warn',
              detail:
                'Le résultat déduit des apports s’écarte de « réalisé + latent ». Des mouvements sans valeur en euros (retraits, dépôts, virements non appariés) manquent aux apports.',
              action: 'Renseignez leur valeur depuis Comptes, ou appariez les virements internes.',
            },
      );
    }
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
