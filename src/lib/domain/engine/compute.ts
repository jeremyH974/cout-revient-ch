/** Boucle chronologique : applique chaque événement aux positions concernées. */
import { isCashLike, isFiat } from '../assets';
import { D, ZERO, type Big } from '../money';
import type {
  AssetCode,
  DepositEvent,
  EngineSettings,
  EventId,
  LedgerEvent,
  UnqualifiedEvent,
} from '../types';
import { PositionState, type Movement } from './position';
import type { CashFlow } from './report';

const KIND_RANK: Record<LedgerEvent['kind'], number> = {
  'opening-balance': 0,
  deposit: 1,
  reward: 2,
  trade: 3,
  migration: 3,
  withdrawal: 4,
  fee: 5,
  unqualified: 6,
};

/**
 * À la même seconde, un échange qui PRODUIT du cash ou du stablecoin (vente, EUR → USDC) passe
 * avant celui qui en CONSOMME (achat payé en USDC) : le règlement Coinhouse enchaîne souvent
 * « vendre X → acheter Y avec le produit » sous un même horodatage.
 */
function flowRank(event: LedgerEvent): number {
  if (event.kind !== 'trade') return 1;
  if (isCashLike(event.in.asset)) return 0;
  if (isCashLike(event.out.asset)) return 1;
  return 2;
}

/**
 * Comparaison de deux `NaiveDateTime` par unités de code (décision n° 81).
 *
 * Mesuré le 01/09/2026 sur 200 000 horodatages : **250 ms** avec `localeCompare` contre **39 ms**
 * ici, pour un ordre **strictement identique**. Le champ vaut `AAAA-MM-JJTHH:mm:ss` — chiffres,
 * tirets, deux-points, et un `T` en position fixe : aucune lettre variable, donc aucune divergence
 * possible entre collation et unités de code. Une propriété fast-check l'exige.
 */
const byInstant = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Tri déterministe : date, puis acquisitions avant cessions, flux, source, puis id. */
export function sortEvents(events: readonly LedgerEvent[]): LedgerEvent[] {
  return [...events].sort(
    (a, b) =>
      byInstant(a.at, b.at) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      flowRank(a) - flowRank(b) ||
      (a.source === b.source ? 0 : a.source === 'coinhouse-csv' ? -1 : 1) ||
      /*
       * `localeCompare` est CONSERVÉ ici, délibérément. Les deux ordres divergent sur la casse —
       * `'ch:a'.localeCompare('ch:A')` rend -1 quand `'ch:a' < 'ch:A'` est faux — et les
       * identifiants portent des lettres (`ch:fee:…`, `ch:mig:d+m`, empreintes hexadécimales).
       * Cet ultime départage décide de l'ordre de consommation des lots, donc du PRU : le gain n'y
       * vaut pas le risque, d'autant qu'on ne l'atteint qu'après égalité sur quatre critères.
       */
      a.id.localeCompare(b.id),
  );
}

export interface LedgerRun {
  positions: Map<AssetCode, PositionState>;
  unqualified: UnqualifiedEvent[];
  cashIn: Big;
  cashOut: Big;
  /** Plus haut niveau atteint par `cashIn − cashOut` : base du ROI du portefeuille. */
  cashEngagedMax: Big;
  subscriptionsEur: Big;
  /** Coût réellement sorti par retrait apparié (id du retrait) : il « voyage » vers le dépôt. */
  transferCosts: Map<EventId, Big>;
  /** Flux externes datés, miroir exact des opérations comptées (voir `CashFlow`) : base du XIRR. */
  cashFlows: CashFlow[];
  /** Quantités des seuls événements de scope 'coinhouse', pour le contrôle de solde. */
  coinhouseQty: Map<AssetCode, Big>;
  warnings: string[];
}

const move = (event: LedgerEvent, kind: Movement['kind'], extra?: Partial<Movement>): Movement => ({
  eventId: event.id,
  rowKeys: event.rowKeys,
  accountId: event.accountId,
  at: event.at,
  kind,
  counterAsset: null,
  quotePrice: null,
  feeEur: ZERO,
  rebateEur: ZERO,
  warnings: event.warnings,
  ...extra,
});

export function runLedger(events: readonly LedgerEvent[], settings: EngineSettings): LedgerRun {
  const positions = new Map<AssetCode, PositionState>();
  const pos = (asset: AssetCode): PositionState => {
    let p = positions.get(asset);
    if (!p) {
      p = new PositionState(asset);
      positions.set(asset, p);
    }
    return p;
  };
  const run: LedgerRun = {
    positions,
    unqualified: [],
    cashIn: ZERO,
    cashOut: ZERO,
    cashEngagedMax: ZERO,
    subscriptionsEur: ZERO,
    transferCosts: new Map(),
    cashFlows: [],
    coinhouseQty: new Map(),
    warnings: [],
  };
  const track = (event: LedgerEvent, asset: AssetCode, signed: Big): void => {
    if (event.scope !== 'coinhouse' || isFiat(asset)) return;
    run.coinhouseQty.set(asset, (run.coinhouseQty.get(asset) ?? ZERO).plus(signed));
  };
  const noteCash = (): void => {
    const engaged = run.cashIn.minus(run.cashOut);
    if (engaged.gt(run.cashEngagedMax)) run.cashEngagedMax = engaged;
  };
  /** Enregistre un flux externe non nul (achats/frais < 0, produits > 0). */
  const flow = (event: LedgerEvent, amountEur: Big): void => {
    if (!amountEur.eq(ZERO)) run.cashFlows.push({ at: event.at, amountEur, eventId: event.id });
  };

  const ordered = sortEvents(events);
  // Virements internes : un dépôt apparié qui arrive avant son retrait (même seconde, horloges
  // décalées entre plateformes) est différé jusqu'à ce que le coût sorti soit connu.
  const pendingTransfers = new Set<EventId>();
  for (const event of ordered)
    if (event.kind === 'withdrawal' && event.transferTo !== undefined)
      pendingTransfers.add(event.id);
  const deferredDeposits = new Map<EventId, DepositEvent[]>();
  const applyDeposit = (event: DepositEvent): void => {
    track(event, event.in.asset, D(event.in.qty));
    const carried =
      event.transferFrom !== undefined ? run.transferCosts.get(event.transferFrom) : undefined;
    const cost = carried ?? (event.costEur ? D(event.costEur) : ZERO);
    let warnings = event.warnings;
    if (carried !== undefined)
      warnings = [...warnings, 'Virement interne : coût d’acquisition repris du retrait apparié.'];
    else if (event.transferFrom !== undefined)
      warnings = event.costEur
        ? [...warnings, 'Virement interne : coût repris du compte d’origine.']
        : [...warnings, 'Virement apparié mais coût d’origine indisponible : 0 € retenu.'];
    else if (!event.costEur)
      warnings = [...warnings, 'Coût d’acquisition inconnu : 0 € retenu (à renseigner).'];
    const acquired = pos(event.in.asset).acquire(
      D(event.in.qty),
      cost,
      'deposit',
      true,
      move(event, 'deposit', { warnings }),
    );
    if (acquired) flow(event, cost.neg());
  };

  for (const event of ordered) {
    switch (event.kind) {
      case 'trade': {
        track(event, event.out.asset, D(event.out.qty).neg());
        track(event, event.in.asset, D(event.in.qty));
        const value = D(event.valueEur);
        const feeEur = event.fee ? D(event.fee.grossEur).minus(event.fee.rebateEur) : ZERO;
        const rebateEur = event.fee ? D(event.fee.rebateEur) : ZERO;
        const outIsCash = isFiat(event.out.asset);
        const inIsCash = isFiat(event.in.asset);
        // Les frais vont à la jambe crypto (ou au stablecoin face à l'euro), jamais aux deux.
        const feeToOut = inIsCash || !isCashLike(event.out.asset);
        // Les apports/retraits en euros ne sont comptés que si l'opération a été appliquée
        // (une cession bloquée ou un achat sur un actif bloqué n'entrent pas dans le P&L).
        let outApplied = true;
        let inApplied = true;
        if (!outIsCash) {
          outApplied =
            pos(event.out.asset).dispose(
              D(event.out.qty),
              value,
              true,
              move(event, 'sell', {
                counterAsset: event.in.asset,
                quotePrice: event.quotePrice,
                feeEur: feeToOut ? feeEur : ZERO,
                rebateEur: feeToOut ? rebateEur : ZERO,
              }),
            ) !== null;
          if (outApplied) flow(event, value);
        }
        if (!inIsCash) {
          inApplied = pos(event.in.asset).acquire(
            D(event.in.qty),
            value,
            'purchase',
            true,
            move(event, 'buy', {
              counterAsset: event.out.asset,
              quotePrice: event.quotePrice,
              feeEur: !feeToOut ? feeEur : ZERO,
              rebateEur: !feeToOut ? rebateEur : ZERO,
            }),
          );
          if (inApplied) flow(event, value.neg());
        }
        const applied = outApplied && inApplied;
        if (applied && outIsCash) run.cashIn = run.cashIn.plus(value);
        if (applied && inIsCash) run.cashOut = run.cashOut.plus(value);
        noteCash();
        break;
      }
      case 'migration': {
        track(event, event.out.asset, D(event.out.qty).neg());
        track(event, event.in.asset, D(event.in.qty));
        const from = pos(event.out.asset);
        const qtyOut = D(event.out.qty);
        const carried = qtyOut.gte(from.qty)
          ? from.costBasis
          : from.costBasis.times(qtyOut).div(from.qty);
        const fair = event.fairValueOutEur ?? event.fairValueInEur;
        const realize = settings.migrationMode === 'realize' && fair !== null;
        const valuation = realize ? D(fair) : carried;
        // Coût reporté : transfert entre actifs, ni achat ni produit (le dénominateur du ROI et
        // « Σ achats » ne bougent pas) ; la part d'achats transférée suit le coût pour que
        // `total = valeur + Σ produits − Σ achats` reste vrai actif par actif.
        // Réalisation à la juste valeur : vraie cession puis vraie acquisition, comptées.
        const disposed = from.dispose(
          qtyOut,
          valuation,
          realize,
          move(event, 'migration-out', { counterAsset: event.in.asset }),
        );
        const to = pos(event.in.asset);
        if (!disposed) {
          // Actif d'origine bloqué (historique manquant) : la quantité reçue existe bel et bien ;
          // on la crée à coût 0 avec avertissement plutôt que de la faire disparaître.
          to.acquire(
            D(event.in.qty),
            ZERO,
            'migration',
            false,
            move(event, 'migration-in', {
              counterAsset: event.out.asset,
              warnings: [
                ...event.warnings,
                `Coût d'acquisition inconnu : l'historique de ${event.out.asset} est incomplet (0 € retenu).`,
              ],
            }),
          );
          break;
        }
        const migAcquired = to.acquire(
          D(event.in.qty),
          valuation,
          'migration',
          realize,
          move(event, 'migration-in', { counterAsset: event.out.asset }),
        );
        if (realize) {
          // Réalisation : cession + acquisition comptées — deux flux qui se neutralisent,
          // conservés pour que les flux restent la décomposition exacte de Σ achats/Σ produits.
          flow(event, valuation);
          if (migAcquired) flow(event, valuation.neg());
        }
        if (!realize) {
          from.investedTotal = from.investedTotal.minus(carried);
          to.investedTotal = to.investedTotal.plus(carried);
          to.noteEngaged();
        }
        break;
      }
      case 'reward': {
        track(event, event.in.asset, D(event.in.qty));
        const fair =
          settings.rewardValuation === 'fair-value' && event.fairValueEur
            ? D(event.fairValueEur)
            : ZERO;
        const p = pos(event.in.asset);
        p.acquire(D(event.in.qty), fair, 'reward', false, move(event, 'reward'));
        p.otherIncome = p.otherIncome.plus(fair);
        break;
      }
      case 'deposit': {
        if (
          event.transferFrom !== undefined &&
          !run.transferCosts.has(event.transferFrom) &&
          pendingTransfers.has(event.transferFrom)
        ) {
          const list = deferredDeposits.get(event.transferFrom) ?? [];
          list.push(event);
          deferredDeposits.set(event.transferFrom, list);
          break;
        }
        applyDeposit(event);
        break;
      }
      case 'withdrawal': {
        track(event, event.out.asset, D(event.out.qty).neg());
        const p = pos(event.out.asset);
        const qty = D(event.out.qty);
        if (event.proceedsEur) {
          const sold = p.dispose(qty, D(event.proceedsEur), true, move(event, 'withdrawal'));
          if (sold) flow(event, D(event.proceedsEur));
        } else {
          const atCost = qty.gte(p.qty) ? p.costBasis : p.costBasis.times(qty).div(p.qty);
          const note =
            event.transferTo !== undefined
              ? 'Virement interne : sortie au coût, le coût est transféré au compte de destination.'
              : 'Retrait valorisé au coût (pas de plus-value constatée).';
          const disposed = p.dispose(
            qty,
            atCost,
            true,
            move(event, 'withdrawal', { warnings: [...event.warnings, note] }),
          );
          if (disposed) flow(event, atCost);
          if (event.transferTo !== undefined && disposed)
            run.transferCosts.set(event.id, disposed.costOfSale);
        }
        if (event.transferTo !== undefined) {
          pendingTransfers.delete(event.id);
          for (const deferred of deferredDeposits.get(event.id) ?? []) applyDeposit(deferred);
          deferredDeposits.delete(event.id);
        }
        break;
      }
      case 'opening-balance': {
        track(event, event.in.asset, D(event.in.qty));
        const opened = pos(event.in.asset).acquire(
          D(event.in.qty),
          D(event.costEur),
          'opening-balance',
          true,
          move(event, 'opening-balance'),
        );
        if (opened) flow(event, D(event.costEur).neg());
        break;
      }
      case 'fee':
        run.subscriptionsEur = run.subscriptionsEur.plus(event.amountEur);
        flow(event, D(event.amountEur).neg());
        break;
      case 'unqualified':
        run.unqualified.push(event);
        for (const leg of event.legs) pos(leg.asset).unqualifiedCount++;
        break;
    }
  }
  // Garde-fou : un dépôt différé dont le retrait n'aurait jamais été exécuté (impossible en
  // principe, la liste vient des mêmes événements) est appliqué avec son repli.
  for (const list of deferredDeposits.values()) for (const deferred of list) applyDeposit(deferred);
  for (const state of positions.values()) run.warnings.push(...state.warnings);
  return run;
}
