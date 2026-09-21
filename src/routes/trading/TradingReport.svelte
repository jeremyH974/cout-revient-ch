<script lang="ts">
  /**
   * Le rapport de trading (décision n° 178).
   *
   * L'écran ne calcule rien : il lit le rapport du moteur de trading et les statistiques des
   * allers-retours, convertit les montants de la devise de cotation vers la devise d'affichage —
   * exactement comme l'écran Trading, par `usdcToDisplay` —, puis passe le tout au constructeur de
   * modèle. Une conversion impossible rend `null`, que le modèle écrit « — » : jamais zéro.
   *
   * Ses statistiques suivent la plage d'analyse, comme l'écran Statistiques ; sa synthèse reste
   * cumulée, comme le tableau de bord (décision n° 179). La page de garde dit les deux.
   */
  import { nowIso, nowMs } from '$lib/clock';
  import type { Big } from '$lib/domain/money';
  import { ZERO } from '$lib/domain/money';
  import type { JournaledTrip } from '$lib/domain/trading/journal';
  import { computeStats, tripsClosedIn } from '$lib/domain/trading/stats';
  import { fmtDate } from '$lib/format/fr';
  import { resolveWindow, todayOf, type Period } from '$lib/history';
  import RangePicker from '../../components/charts/RangePicker.svelte';
  import type { ReportModel } from '$lib/export/report-model';
  import {
    buildTradingReportModel,
    type TradingReportAccount,
  } from '$lib/export/trading-report-model';
  import { reportAt } from '$lib/reports';
  import { router } from '$lib/router.svelte';
  import ReportShell from '../../components/report/ReportShell.svelte';
  import { app } from '../../state/app.svelte';

  const report = reportAt('tradingReport')!;
  let generatedAt = $state(nowIso());

  const money = (value: Big | null): Big | null =>
    value === null ? null : app.usdcToDisplay(value);
  const toDisplay = (t: JournaledTrip, value: Big): Big | null =>
    app.quoteToDisplay(t.trip.quote, value);

  /** Les mêmes périodes que l'écran Statistiques : « 1 jour » n'a pas de sens pour des ratios. */
  const PERIODS: Period[] = ['1w', '1m', '3m', '1y', 'all', 'custom'];
  // Pas `window` : le nom est déjà celui de l'objet global.
  const dayWindow = $derived(
    resolveWindow(app.state.ui.period, app.state.ui.customRange, todayOf(nowMs())),
  );
  const statsPeriod = $derived(
    dayWindow.from === null
      ? 'depuis l’origine'
      : `clos du ${fmtDate(dayWindow.from)} au ${fmtDate(dayWindow.to)}`,
  );

  const trading = $derived(app.tradingReport);
  const hasTrading = $derived(trading.accounts.length > 0 || app.roundTrips.length > 0);
  const label = (id: string): string => app.accountLabels[id] ?? id;

  const model = $derived.by((): ReportModel | null => {
    if (!hasTrading) return null;
    const t = trading.totals;
    const accounts: TradingReportAccount[] = trading.accounts.map((a) => ({
      label: label(a.accountId),
      equity: money(a.equity),
      net: money(a.totals.net),
      realized: money(a.totals.realized),
      fees: money(a.totals.perpFees),
      funding: money(a.totals.funding),
      netFlows: money(a.totals.netFlows),
      fills: a.totals.fills,
    }));
    return buildTradingReportModel(
      {
        net: money(t.net),
        realized: money(t.realized),
        fees: money(t.perpFees),
        funding: money(t.funding),
        unrealized: money(trading.unrealized),
        equity: money(trading.equity),
        netFlows: money(t.netFlows),
        accounts,
        unvalued: trading.unvalued.map(label),
        nativeFeeTokens: Object.entries(t.feesNative)
          .filter(([, amount]) => !amount.eq(ZERO))
          .map(([token]) => token.toUpperCase()),
        stats: computeStats(tripsClosedIn(app.roundTrips, dayWindow), toDisplay),
        statsPeriod,
      },
      {
        discreet: app.state.ui.discreet,
        currency: app.currency,
        generatedAt,
        version: __APP_VERSION__,
      },
    );
  });
</script>

<ReportShell {report} {model} stamp={() => (generatedAt = nowIso())}>
  {#snippet controls()}
    <RangePicker id="trading-report" available={PERIODS} />
    <p class="muted small">
      La plage gouverne les statistiques ; la synthèse couvre tout l’historique.
    </p>
  {/snippet}
  {#snippet empty()}
    <h2>Rien à rapporter pour l’instant</h2>
    <p class="muted">
      Ce rapport s’appuie sur vos comptes de trading. Ajoutez une adresse ou saisissez un trade, et
      il se remplira.
    </p>
    <a class="secondary" href={router.href({ name: 'trading' })}>Aller au trading</a>
  {/snippet}
</ReportShell>
