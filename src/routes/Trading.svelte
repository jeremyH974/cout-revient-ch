<script module lang="ts">
  import { CandleCache } from '$lib/import/hyperliquid/candles';

  /** Bougies de la courbe détaillée : cache de session partagé entre visites, jamais persisté. */
  const candleCache = new CandleCache();
</script>

<script lang="ts">
  /**
   * Espace Trading — tableau de bord (P20, présentation alignée sur la synthèse Investissement) :
   * carte Synthèse (dépôts nets, équité, P&L total), courbe d'équité / P&L de la plateforme
   * (`portfolio`, persistée à la synchronisation), résultat par période, positions ouvertes
   * (chacune renvoie vers son aller-retour), avoirs spot, auto-vérification. Les fills vivent
   * dans leur propre onglet. Jamais de PRU ici ; montants USDC convertis au taux BCE du jour.
   */
  import { untrack } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { D, ZERO, type Big } from '$lib/domain/money';
  import {
    QUOTE_ASSET,
    accountReport,
    totalsSince,
    type TradingTotals,
  } from '$lib/domain/trading/compute';
  import { curveWindow } from '$lib/domain/trading/curve';
  import {
    detailedCurve,
    marketsHeld,
    type DetailOutcome,
    type PriceBook,
  } from '$lib/domain/trading/equity-path';
  import { rateLookup } from '$lib/fx';
  import { dayToMs, resolveWindow, todayOf, type Period } from '$lib/history';
  import { candleWords, marketList, platformPoints } from '$lib/format/curve-detail';
  import { fmtRelative, roundsToZero } from '$lib/format/fr';
  import { pointMs } from '$lib/history/days';
  import { formatInstant } from '$lib/history/intraday-series';
  import {
    DETAIL_MIN_SPAN_MS,
    candleFetcher,
    liveCandleFloor,
    loadPriceBook,
    needsReplan,
    planDetail,
    type DetailPlan,
  } from '$lib/import/hyperliquid/candles';
  import { equityAnchors, equityMoves, spotCandleCoin } from '$lib/import/hyperliquid/equity-moves';
  import { demoFixtureClient } from '$lib/import/hyperliquid/fixture-client';
  import { msToParisNaive } from '$lib/import/time';
  import { router } from '$lib/router.svelte';
  import { DISCUSSIONS_URL } from '$lib/support/links';
  import EvolutionChart, { type ChartPoint } from '../components/charts/EvolutionChart.svelte';
  import type { TimeWindow } from '../components/charts/zoom';
  import AppBar from '../components/layout/AppBar.svelte';
  import Info from '../components/shared/Info.svelte';
  import Money from '../components/shared/Money.svelte';
  import Qty from '../components/shared/Qty.svelte';
  import PositionRow from '../components/trading/PositionRow.svelte';
  import RangePicker from '../components/charts/RangePicker.svelte';
  import TradingTabs from '../components/trading/TradingTabs.svelte';
  import { app } from '../state/app.svelte';

  /**
   * Le résultat suit la plage de l'application (décision n° 156). Il avait son propre vocabulaire —
   * « 7 jours / 30 jours / Tout » — si bien que la vue d'ensemble et cet écran pouvaient afficher
   * deux périodes différentes sans que rien ne le dise.
   *
   * Ce bloc, lui, se calcule depuis les fills : il peut honorer n'importe quelle fenêtre. C'est la
   * COURBE, plus haut, qui ne le peut pas — ses fenêtres viennent de la plateforme.
   */
  const period = $derived<Period>(app.state.ui.period);
  let selected = $state<string>('all');

  const report = $derived(app.tradingReport);
  const accounts = $derived(app.hlAccounts);
  const current = $derived(selected === 'all' ? null : (accountReport(report, selected) ?? null));
  const scoped = $derived(current ? { ...report, accounts: [current] } : report);
  const since = $derived.by((): number => {
    const { from } = resolveWindow(period, app.state.ui.customRange, todayOf(nowMs()));
    return from === null ? 0 : dayToMs(from);
  });
  const totals: TradingTotals = $derived(totalsSince(scoped, since));
  const allTotals: TradingTotals = $derived(totalsSince(scoped, 0));
  /** `null` = pas d'instantané : l'équité est **inconnue**, pas nulle (décision n° 97). */
  const equity = $derived(current ? current.equity : report.equity);
  const unrealized = $derived(current ? current.unrealized : report.unrealized);
  /** P&L total = réalisé net (tout l'historique) + latent des positions ouvertes. */
  const totalPnl = $derived(allTotals.net.plus(unrealized));
  const money = (value: Big | null): Big | null =>
    value === null ? null : app.usdcToDisplay(value);
  const positions = $derived(scoped.accounts.flatMap((a) => a.snapshot?.positions ?? []));
  const holdings = $derived(scoped.accounts.flatMap((a) => a.snapshot?.spot ?? []));
  /** Au moins un des deux flux est demandé : la pastille d'état n'a de sens que dans ce cas. */
  const liveOn = $derived(app.state.ui.liveMids || app.state.ui.liveFills);
  const syncing = $derived(accounts.some((a) => app.syncStatus[a.id]?.syncing));
  const lastSyncAt = $derived.by((): string | null => {
    const dates = scoped.accounts
      .map((a) => app.state.hyperliquid.accounts[a.accountId]?.lastSyncAt ?? null)
      .filter((d): d is string => d !== null)
      .sort();
    return dates[0] ?? null;
  });
  const errors = $derived(
    accounts
      .map((a) => app.syncStatus[a.id]?.error)
      .filter((e): e is string => typeof e === 'string'),
  );
  const fxMissing = $derived(app.usdcToDisplay(D('1')) === null);
  /**
   * La **trésorerie** du compte (USDC) se convertit au taux BCE, comme partout ailleurs dans
   * l'app (décision n° 18) — jamais au cours de marché du jeton. Elle s'affichait ici à 0,92 €
   * quand le taux du jour en donnait 0,909 : la ligne ne s'additionnait donc pas avec la valeur
   * du compte, à 7 € près sur le jeu de démonstration. Les autres jetons, eux, ont bien un cours.
   */
  const holdingValue = (asset: string, qty: string): Big | null => {
    if (asset === QUOTE_ASSET) return app.usdcToDisplay(D(qty));
    const quote = app.displayQuotes[asset];
    return quote ? D(quote.priceEur).times(qty) : null;
  };
  const label = (accountId: string): string => app.accountLabels[accountId] ?? accountId;
  /** Aller-retour ouvert d'une position (détail + journal) ; `null` si introuvable. */
  const tripOfPosition = (symbol: string): string | null =>
    app.roundTrips.find(
      (t) =>
        t.trip.status === 'open' &&
        t.trip.symbol === symbol &&
        (selected === 'all' ? true : t.trip.accountId === selected),
    )?.trip.id ?? null;

  // --- Courbe `portfolio` (équité ou P&L), convertie point par point au taux BCE du jour --------
  /**
   * **Ces fenêtres ne sont pas les nôtres** : Hyperliquid ne sert que jour, semaine, mois et tout.
   * La courbe garde donc son propre sélecteur là où le reste de l'écran suit la plage de
   * l'application — et le dit sous le graphique (décision n° 156). Lui faire afficher une plage
   * libre reviendrait à annoncer une période qu'on n'honore pas ; la recalculer depuis les fills
   * est un autre chantier, qui changerait la source et donc le chiffre.
   */
  type CurvePeriod = 'day' | 'week' | 'month' | 'allTime';
  const CURVE_PERIODS: { id: CurvePeriod; label: string }[] = [
    { id: 'day', label: '1J' },
    { id: 'week', label: '1S' },
    { id: 'month', label: '1M' },
    { id: 'allTime', label: 'Tout' },
  ];
  let curvePeriod = $state<CurvePeriod>('month');
  let curveMetric = $state<'equity' | 'pnl'>('equity');
  /** La courbe vient de la plateforme, par compte : consolidée seulement s'il n'y a qu'un compte. */
  const curveAccount = $derived(
    current ? current.accountId : accounts.length === 1 ? accounts[0]!.id : null,
  );
  /** Les fenêtres de la plateforme, dites en durée plutôt qu'en sigle. */
  const CURVE_WORDS: Record<CurvePeriod, string> = {
    day: 'Sur 24 h',
    week: 'Sur 7 jours',
    month: 'Sur 30 jours',
    allTime: "Depuis l'ouverture du compte",
  };
  /**
   * Gain ou perte de la fenêtre affichée (décision n° 162) : la réponse que la courbe d'équité ne
   * donne pas, puisqu'elle monte aussi à chaque dépôt. Même compte et même fenêtre que la courbe.
   */
  const curveResult = $derived.by(() => {
    if (curveAccount === null) return null;
    const series = app.state.hyperliquid.accounts[curveAccount]?.portfolio?.[curvePeriod];
    return series ? curveWindow(series.accountValueHistory, series.pnlHistory) : null;
  });
  const curveSeries = $derived(
    curveAccount === null
      ? null
      : (app.state.hyperliquid.accounts[curveAccount]?.portfolio?.[curvePeriod] ?? null),
  );
  const usdRates = $derived(rateLookup(app.state.fx.rates.USD ?? {}));
  /** Montant en dollars → valeur tracée, au taux BCE du jour de l'instant ; `null` sans taux. */
  const plotValue = (ms: number, value: Big): { day: string; primary: number } | null => {
    const naive = msToParisNaive(ms);
    const rate = app.currency === 'USD' ? '1' : usdRates.rate(naive.slice(0, 10));
    if (rate === null || !D(rate).gt(ZERO)) return null;
    return { day: naive, primary: Number(value.div(rate).toFixed(6)) };
  };
  /** Points de la plateforme, avec leur instant réel : la courbe détaillée s'y insère. */
  const curveEntries = $derived.by((): { ms: number; point: ChartPoint }[] => {
    const series = curveSeries;
    if (!series) return [];
    const raw = curveMetric === 'equity' ? series.accountValueHistory : series.pnlHistory;
    const entries: { ms: number; point: ChartPoint }[] = [];
    // Tous les points de la plateforme, sans amincissement : la courbe doit être exactement celle
    // du Portfolio Hyperliquid (l'écraser à un point par jour déforme les épisodes violents).
    for (const [ms, value] of raw) {
      const plotted = plotValue(ms, D(value));
      if (plotted === null) continue;
      entries.push({
        ms,
        point: { day: plotted.day.slice(0, 16), primary: plotted.primary, secondary: null },
      });
    }
    // Équité : référence = valeur au départ de la période → vert au-dessus, rouge en dessous.
    if (curveMetric === 'equity' && entries.length > 0) {
      const start = entries[0]!.point.primary;
      for (const entry of entries) entry.point.secondary = start;
    }
    return entries;
  });
  const curvePoints = $derived(curveEntries.map((e) => e.point));

  // --- Courbe détaillée (décision n° 164) -----------------------------------------------------
  /**
   * Zoomée, la courbe se reconstitue entre les points de la plateforme : les bruts du compte,
   * valorisés aux bougies d'Hyperliquid, calés et recoupés sur ces points. La vue entière reste
   * exactement celle de la plateforme ; un détail qui ne recoupe pas est écarté, jamais lissé.
   */
  let curveView = $state<TimeWindow | null>(null);
  const zoomed = $derived(curveView !== null);
  /** Le compte a une courbe de la plateforme : le détail est possible, sans rien calculer encore. */
  const detailable = $derived(
    curveAccount !== null && Boolean(app.state.hyperliquid.accounts[curveAccount]?.portfolio),
  );
  /** Les bruts rejoués ne se préparent qu'au premier zoom : lus plus tôt, ils coûteraient à chaque visite. */
  const detailInputs = $derived.by(() => {
    if (curveAccount === null) return null;
    const data = app.state.hyperliquid.accounts[curveAccount];
    if (!data?.portfolio) return null;
    return {
      ...equityMoves(data, app.state.hyperliquid.spotPairs),
      anchors: equityAnchors(data),
    };
  });
  /** Instant réel → abscisse du graphique, qui lit des heures de Paris. */
  const chartMs = (ms: number): number => pointMs(msToParisNaive(ms));
  /** L'inverse, exact hors de l'heure d'un changement d'heure dans un autre fuseau que Paris. */
  const realMs = (value: number): number => value - (chartMs(value) - value);

  let detailLoaded = $state.raw<{ key: string; plan: DetailPlan; prices: PriceBook } | null>(null);
  let detailPending = $state.raw<DetailPlan | null>(null);
  let detailError = $state<string | null>(null);
  /** La vue n'a pas de pas de bougies servi (fenêtre trop large ou trop ancienne). */
  let detailUnplanned = $state(false);
  let detailAbort: AbortController | null = null;
  const detailKey = $derived(`${curveAccount}|${curvePeriod}`);

  function resetDetail(): void {
    detailAbort?.abort();
    detailAbort = null;
    detailLoaded = null;
    detailPending = null;
    detailError = null;
    detailUnplanned = false;
  }

  async function loadDetail(
    key: string,
    plan: DetailPlan,
    held: { perps: string[]; tokens: string[] },
  ): Promise<void> {
    detailAbort?.abort();
    const controller = new AbortController();
    detailAbort = controller;
    detailPending = plan;
    detailError = null;
    try {
      const prices = await loadPriceBook(
        candleCache,
        candleFetcher(app.state.ui.demoMode ? await demoFixtureClient() : app.hlInfoClient()),
        held,
        plan,
        (token) => spotCandleCoin(token, app.state.hyperliquid.spotPairs),
        nowMs(),
        controller.signal,
      );
      if (!controller.signal.aborted) detailLoaded = { key, plan, prices };
    } catch (error) {
      if (!controller.signal.aborted)
        detailError = error instanceof Error ? error.message : String(error);
    } finally {
      if (detailAbort === controller) {
        detailAbort = null;
        detailPending = null;
      }
    }
  }

  // Le détail suit la vue quand elle se pose : un glissement ne lance pas une requête par image.
  $effect(() => {
    const view = curveView;
    if (view === null) {
      untrack(resetDetail);
      return;
    }
    const inputs = detailInputs;
    const history = curveSeries?.accountValueHistory ?? [];
    const key = detailKey;
    if (inputs === null || history.length < 2) {
      untrack(resetDetail);
      return;
    }
    const extent = { from: history[0]![0], to: history[history.length - 1]![0] };
    const timer = setTimeout(() => {
      const plan = planDetail(
        { from: realMs(view.from), to: realMs(view.to) },
        extent,
        inputs.anchors.map(([t]) => t),
        // La vraie API ne sert que les bougies récentes ; la démonstration, hors ligne, tout.
        app.state.ui.demoMode ? () => Number.NEGATIVE_INFINITY : liveCandleFloor(nowMs()),
      );
      detailUnplanned = plan === null;
      if (plan === null) return;
      const loaded = detailLoaded?.key === key ? detailLoaded.plan : null;
      if (!needsReplan(detailPending ?? loaded, plan)) return;
      void loadDetail(key, plan, marketsHeld(inputs.moves, inputs.spot, plan.from, plan.to));
    }, 250);
    return () => clearTimeout(timer);
  });

  const detail = $derived.by((): DetailOutcome | null => {
    const loaded = detailLoaded;
    const inputs = detailInputs;
    const series = curveSeries;
    if (!zoomed || loaded === null || loaded.key !== detailKey || !inputs || !series) return null;
    return detailedCurve({
      moves: inputs.moves,
      spot: inputs.spot,
      prices: loaded.prices,
      from: loaded.plan.from,
      to: loaded.plan.to,
      intervalMs: loaded.plan.interval.ms,
      equity: inputs.anchors,
      pnl:
        curveMetric === 'pnl'
          ? { equity: series.accountValueHistory, points: series.pnlHistory }
          : null,
    });
  });

  /**
   * Points tracés : ceux de la plateforme hors de la fenêtre reconstituée, le détail dedans. Le
   * premier et le dernier point de la plateforme restent toujours : ils bornent le zoom, et les
   * déplacer remettrait la vue à zéro.
   */
  const chartPoints = $derived.by((): ChartPoint[] => {
    const outcome = detail;
    const entries = curveEntries;
    if (outcome?.kind !== 'ok' || detailLoaded === null || entries.length < 2) return curvePoints;
    const { from, to } = detailLoaded.plan;
    const lo = pointMs(entries[0]!.point.day);
    const hi = pointMs(entries[entries.length - 1]!.point.day);
    const reference = entries[0]!.point.secondary;
    const merged = entries.filter(
      (e, i) => i === 0 || i === entries.length - 1 || e.ms < from || e.ms > to,
    );
    for (const p of outcome.points) {
      const plotted = plotValue(p.time, p.value);
      if (plotted === null) continue;
      const x = pointMs(plotted.day);
      if (x <= lo || x >= hi) continue;
      merged.push({ ms: p.time, point: { ...plotted, secondary: reference } });
    }
    return merged.sort((a, b) => a.ms - b.ms).map((e) => e.point);
  });
  const instantLabel = (ms: number): string =>
    formatInstant(msToParisNaive(ms), { withDate: true });

  async function refresh(): Promise<void> {
    await app.syncHyperliquid(selected === 'all' ? undefined : selected);
    void app.refreshPrices(true);
  }
</script>

<AppBar title="Trading" />

{#if app.hasTrading || app.roundTrips.length > 0}
  <TradingTabs active="trading" />
{/if}

{#if !app.hasTrading}
  <section class="card empty">
    <h2>Vos trades, bientôt ici</h2>
    <p>
      Cet espace est séparé de l'investissement : un trade se lit en aller-retour (entrée → sortie),
      avec un P&L net de frais et de funding, un résultat en R, une note « pourquoi j'ai pris ce
      trade » et des statistiques par setup — jamais un PRU.
    </p>
    <ul>
      <li>
        <strong>Hyperliquid en lecture seule</strong> : collez votre adresse publique ; aucune clé, rien
        ne quitte votre navigateur à part l'adresse, envoyée à Hyperliquid seulement.
      </li>
      <li>
        <strong>Saisie manuelle</strong> d'un trade en quelques secondes, depuis le téléphone.
      </li>
      <li>
        <strong>Journal et statistiques</strong> : espérance, taux de réussite, profit factor, drawdown,
        avec un garde-fou tant que l'échantillon est trop petit.
      </li>
    </ul>
    <a class="primary" href={router.href({ name: 'accounts' })}>Ajouter une adresse Hyperliquid</a>
    <p class="small muted">
      Avancement et retours :
      <a href={DISCUSSIONS_URL} target="_blank" rel="noopener noreferrer">discussions du projet</a>.
    </p>
  </section>
{:else}
  <section class="card summary">
    <div class="tools">
      <p class="label">Synthèse</p>
      <div class="actions">
        {#if accounts.length > 1}
          <select aria-label="Compte de trading" bind:value={selected}>
            <option value="all">Tous les comptes</option>
            {#each accounts as a (a.id)}
              <option value={a.id}>{a.label}</option>
            {/each}
          </select>
        {/if}
        <button class="tool" type="button" onclick={() => void refresh()} disabled={syncing}>
          {syncing ? 'Synchronisation…' : 'Actualiser'}
        </button>
        <label class="live check small" title="Cours Hyperliquid poussés par WebSocket (opt-in)">
          <input
            type="checkbox"
            checked={app.state.ui.liveMids}
            onchange={(e) => app.setLiveMids(e.currentTarget.checked)}
          />
          Prix en direct
        </label>
        <label
          class="live check small"
          title="Vos exécutions poussées par WebSocket dès qu'elles ont lieu (opt-in)"
        >
          <input
            type="checkbox"
            checked={app.state.ui.liveFills}
            onchange={(e) => app.setLiveFills(e.currentTarget.checked)}
          />
          Trades en direct
        </label>
        {#if liveOn}
          <span
            class="dot {app.liveStatus}"
            role="status"
            aria-label={app.liveStatus === 'live'
              ? 'Flux en direct : connecté'
              : app.liveStatus === 'retry'
                ? 'Flux en direct : reconnexion en cours'
                : app.liveStatus === 'connecting'
                  ? 'Flux en direct : connexion…'
                  : 'Flux en direct : arrêté'}
          ></span>
        {/if}
      </div>
    </div>
    <p class="muted small" aria-live="polite">
      {#if syncing}
        Lecture des fills, du funding et des mouvements…
      {:else if app.state.ui.liveFills && app.liveFillsAt}
        {app.liveFillsCount} exécution{app.liveFillsCount > 1 ? 's' : ''} reçue{app.liveFillsCount >
        1
          ? 's'
          : ''} en direct · dernière {fmtRelative(app.liveFillsAt, nowMs())}
      {:else if lastSyncAt}
        Synchronisé : {fmtRelative(lastSyncAt, nowMs())} · adresse publique, lecture seule
      {:else}
        Jamais synchronisé
      {/if}
    </p>
    <div class="trio">
      <div>
        <p class="label">
          Dépôts nets <Info title="Dépôts nets"
            >Somme signée des mouvements d'argent du compte perps : dépôts, retraits, transferts
            spot ↔ perps, vaults. C'est le capital réellement engagé sur la plateforme.</Info
          >
        </p>
        <p class="big"><Money value={money(allTotals.netFlows)} compact /></p>
      </div>
      <div>
        <p class="label">
          Valeur du compte <Info title="Valeur du compte"
            >Équité du compte perps <strong>plus</strong> les avoirs spot valorisés — le périmètre que
            la plateforme appelle « capitaux totaux ». Un compte sans position ouverte a une équité perps
            nulle et tout son argent du côté spot : ne compter que les perps afficherait zéro (décision
            n° 100).</Info
          >
        </p>
        <p class="big"><Money value={money(equity)} compact strong /></p>
        {#if equity === null}
          <!-- « — » plutôt qu'un zéro : l'auto-vérification, plus bas, dit quel compte est muet. -->
          <p class="muted small">Pas encore d'instantané : valeur inconnue, pas nulle.</p>
        {/if}
      </div>
      <div>
        <p class="label">
          P&L total <Info title="P&L total"
            >Réalisé net (closedPnl brut − frais + funding, tout l'historique) + latent des
            positions ouvertes. Jamais additionné aux plus-values d'investissement.</Info
          >
        </p>
        <p class="big"><Money value={money(totalPnl)} sign colored strong /></p>
      </div>
    </div>
    <p class="line">
      Réalisé net <Money value={money(allTotals.net)} sign colored /> · Latent
      <Money value={money(unrealized)} sign colored /> · Frais
      <Money value={money(allTotals.perpFees.neg())} sign colored /> · Funding
      <Money value={money(allTotals.funding)} sign colored />
    </p>
    {#if fxMissing}
      <p class="warn small">Taux de change indisponible : montants masqués en euros.</p>
    {/if}
    {#each errors as error (error)}
      <p class="warn small" role="alert">Synchronisation interrompue : {error}</p>
    {/each}
    <a class="report-link" href={router.href({ name: 'tradingReport' })}>
      Rapport de trading (PDF) →
    </a>
  </section>

  <section class="card evolution">
    <div class="tools">
      <h2>Évolution</h2>
      <div class="actions">
        <div class="segments" role="group" aria-label="Courbe">
          <button
            type="button"
            class="segment"
            aria-pressed={curveMetric === 'equity'}
            onclick={() => (curveMetric = 'equity')}>Équité</button
          >
          <button
            type="button"
            class="segment"
            aria-pressed={curveMetric === 'pnl'}
            onclick={() => (curveMetric = 'pnl')}>P&L</button
          >
        </div>
        <div class="segments" role="group" aria-label="Période de la courbe">
          {#each CURVE_PERIODS as p (p.id)}
            <button
              type="button"
              class="segment"
              aria-pressed={curvePeriod === p.id}
              onclick={() => (curvePeriod = p.id)}>{p.label}</button
            >
          {/each}
        </div>
      </div>
    </div>
    {#if curveAccount === null}
      <p class="muted small">
        Choisissez un compte (sélecteur de la synthèse) pour afficher sa courbe : la plateforme
        fournit une courbe par adresse.
      </p>
    {:else if curvePoints.length < 2}
      <p class="muted small">
        Courbe indisponible pour l'instant : lancez « Actualiser » (elle est lue avec la
        synchronisation, puis conservée hors ligne).
      </p>
    {:else}
      {#if curveResult}
        <div class="period">
          <p class="period-result">
            {CURVE_WORDS[curvePeriod]} : {#if roundsToZero(money(curveResult.pnl))}<strong
                >résultat nul</strong
              >{:else}<strong>{curveResult.pnl.lt(ZERO) ? 'perte de' : 'gain de'}</strong>
              <Money value={money(curveResult.pnl)} sign colored strong />{/if}
          </p>
          <p class="muted small period-detail">
            Équité de <Money value={money(curveResult.startValue)} /> à
            <Money
              value={money(curveResult.endValue)}
            />{#if roundsToZero(money(curveResult.flows))}, sans dépôt ni retrait sur la période.{:else},
              dont
              <Money value={money(curveResult.flows)} sign /> de dépôts, retraits et transferts : de l'argent
              ajouté ou retiré, pas du résultat.{/if}
          </p>
        </div>
      {/if}
      <EvolutionChart
        points={chartPoints}
        currency={app.currency}
        zeroLine={curveMetric === 'pnl'}
        colorMode={curveMetric === 'pnl' ? 'sign' : 'vsSecondary'}
        step
        holes={false}
        labels={{
          primary: curveMetric === 'pnl' ? 'P&L' : 'Équité',
          secondary: curveMetric === 'pnl' ? null : 'départ',
        }}
        discreet={app.state.ui.discreet}
        zoomable
        bind:view={curveView}
        minSpanMs={detailable ? DETAIL_MIN_SPAN_MS : Number.POSITIVE_INFINITY}
      />
      {#if zoomed && detailable}
        <p class="small detail-note" aria-live="polite">
          {#if detail?.kind === 'ok' && detailLoaded}
            <strong>Détail reconstitué</strong> ({candleWords(detailLoaded.plan.interval.id)})
            depuis vos exécutions, le funding et les mouvements du compte, au dernier cours échangé
            plutôt qu'au prix de marque. Il recoupe {platformPoints(detail.checked)}
            {#if detail.flatDeviation !== null}à <Money value={money(detail.flatDeviation)} /> près{detail.flatChecked <
              detail.checked
                ? ' aux instants sans position, et dans la marge du cours ailleurs'
                : ''}.{:else}dans la marge du cours de chaque bougie.{/if}
          {:else if detailError}
            Détail indisponible : {detailError}. La courbe reste celle de la plateforme.
          {:else if detailPending}
            Chargement du détail ({candleWords(detailPending.interval.id)})…
          {:else if detailUnplanned}
            Détail indisponible pour cette fenêtre : Hyperliquid n'en sert plus les cours assez
            finement.
          {:else if detail?.kind === 'mismatch'}
            <strong>Détail écarté</strong> : au point d'Hyperliquid du {instantLabel(
              detail.worst.time,
            )}, la reconstitution s'écarte de <Money value={money(detail.worst.deviation.abs())} />,
            au-delà des
            <Money value={money(detail.worst.allowed)} /> que le cours explique. Un mouvement du compte
            n'est sans doute pas reconstitué (vault, staking, jeton sans cours) : la courbe reste celle
            de la plateforme.
          {:else if detail?.kind === 'no-price'}
            Détail indisponible : pas de cours pour {marketList(detail.markets)}. La courbe reste
            celle de la plateforme.
          {:else if detail?.kind === 'no-anchor'}
            Détail indisponible : aucun point d'Hyperliquid dans la fenêtre pour caler la
            reconstitution.
          {:else}
            Chargement du détail…
          {/if}
        </p>
      {/if}
      <p class="muted small">
        Courbe fournie par la plateforme ({label(curveAccount)}), convertie au taux BCE de chaque
        jour ; le P&L de la courbe est celui de la plateforme (période glissante). Zoomée, elle se
        reconstitue entre ses points depuis vos exécutions et les cours, jusqu'à la minute.
        <strong>Ses fenêtres sont celles d'Hyperliquid</strong> — jour, semaine, mois, tout — et ne suivent
        donc pas la plage choisie plus haut : afficher ici une période qu'on ne reçoit pas reviendrait
        à l'inventer.
      </p>
    {/if}
  </section>

  <section class="card">
    <div class="head">
      <h2>Résultat</h2>
      <RangePicker id="trading" available={['1w', '1m', '3m', '1y', 'all', 'custom']} />
    </div>
    <dl class="kpis">
      <div class="main">
        <dt>P&L net</dt>
        <dd><Money value={money(totals.net)} sign colored strong /></dd>
      </div>
      <div>
        <dt>Réalisé (brut)</dt>
        <dd><Money value={money(totals.realized)} sign colored /></dd>
      </div>
      <div>
        <dt>Frais</dt>
        <dd><Money value={money(totals.perpFees.neg())} sign colored /></dd>
      </div>
      <div>
        <dt>Funding</dt>
        <dd><Money value={money(totals.funding)} sign colored /></dd>
      </div>
      <div>
        <dt>Dépôts nets</dt>
        <dd><Money value={money(totals.netFlows)} sign /></dd>
      </div>
      <div>
        <dt>Fills (dont clôtures)</dt>
        <dd class="num">{totals.fills} ({totals.closingFills})</dd>
      </div>
    </dl>
    <p class="muted small">
      P&L net = réalisé brut − frais perps + funding, sur les fills de la période ; le latent des
      positions ouvertes est affiché à part. Le détail des fills vit dans l'onglet
      <a href={router.href({ name: 'fills' })}>Fills</a>.
    </p>
  </section>

  <section class="card positions-card">
    <h2>Positions ouvertes</h2>
    {#if positions.length === 0}
      <p class="muted">Aucune position ouverte à la dernière synchronisation.</p>
    {:else}
      <div class="table-head" aria-hidden="true">
        <span>Actif</span><span class="num">Taille · entrée</span><span class="num"
          >Marque · liq.</span
        ><span class="num">Valeur</span><span class="num">Latent</span>
      </div>
      <ul class="positions" aria-label="Positions ouvertes">
        {#each positions as p (p.symbol + p.side)}
          <PositionRow position={p} tripId={tripOfPosition(p.symbol)} />
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <h2>Avoirs spot</h2>
    {#if holdings.length === 0}
      <p class="muted">Aucun avoir spot.</p>
    {:else}
      <ul class="rows" aria-label="Avoirs spot">
        {#each holdings as h (h.asset)}
          <li>
            <div class="position">
              <div class="main">
                <strong>{h.asset.toUpperCase()}</strong>
                <span class="muted small"><Qty value={D(h.qty)} /></span>
              </div>
              <div class="side"><Money value={holdingValue(h.asset, h.qty)} /></div>
            </div>
          </li>
        {/each}
      </ul>
      <p class="muted small">
        Valorisés au dernier prix connu, et <strong>comptés dans la valeur du compte</strong>. Pour
        un PRU et des plus-values, cochez « traiter le spot comme de l'investissement » sur le
        compte (écran Comptes).
      </p>
    {/if}
  </section>

  <section class="card">
    <h2>Auto-vérification</h2>
    <ul class="checks">
      {#each scoped.accounts as a (a.accountId)}
        <li>
          {#if a.reconciliation === null}
            <span class="dot info" aria-hidden="true"></span>
            {label(a.accountId)} : pas encore d'instantané de compte.
          {:else if a.reconciliation.gap.abs().lte('0.01')}
            <span class="dot ok" aria-hidden="true"></span>
            {label(a.accountId)} : valeur du compte = apports + réalisé − frais + funding + latent.
          {:else if a.reconciliation.spotSales > 0}
            <span class="dot info" aria-hidden="true"></span>
            {label(a.accountId)} : écart de
            <Money value={money(a.reconciliation.gap)} sign /> — il contient la plus-value réalisée de
            vos {a.reconciliation.spotSales} vente{a.reconciliation.spotSales > 1 ? 's' : ''} spot, que
            cet espace ne calcule pas. Pour un PRU et des plus-values sur le spot, cochez « traiter le
            spot comme de l'investissement » sur le compte.
          {:else}
            <span class="dot warn" aria-hidden="true"></span>
            {label(a.accountId)} : écart de réconciliation
            <Money value={money(a.reconciliation.gap)} sign /> — mouvements non interprétés ou historique
            incomplet ; relancez une synchronisation.
          {/if}
        </li>
      {/each}
    </ul>
    <p class="muted small">
      Réconciliation sur l'instantané lu {lastSyncAt ? fmtRelative(lastSyncAt, nowMs()) : '—'} ; tolérance
      0,01 USDC.
    </p>
  </section>
{/if}

<style>
  .live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .dot {
    width: 0.6em;
    height: 0.6em;
    border-radius: 50%;
    background: var(--fg-muted);
  }
  .dot.live {
    background: var(--gain, #15803d);
  }
  .dot.retry,
  .dot.connecting {
    background: var(--warn, #b45309);
  }
  .empty {
    display: grid;
    gap: var(--space-2);
    border-left: 4px solid var(--accent-trading);
  }
  .empty h2,
  .head h2,
  .evolution h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  ul {
    margin: 0;
    padding: 0;
  }
  .empty ul {
    display: grid;
    gap: var(--space-2);
    padding-left: 1.2em;
  }
  .primary {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
    text-decoration: none;
  }
  .summary,
  .evolution {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .period {
    display: grid;
    gap: var(--space-1);
  }
  .period p {
    margin: 0;
  }
  .period-result {
    font-size: var(--fs-md);
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .big {
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.1;
  }
  .trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .trio > div {
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }
  .line {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .tool,
  .segment {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tool:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .segments {
    display: flex;
    gap: var(--space-1);
  }
  .segment[aria-pressed='true'] {
    background: var(--accent-trading);
    border-color: var(--accent-trading);
    color: var(--accent-fg);
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }
  .kpis div {
    display: grid;
    gap: 2px;
  }
  .kpis .main {
    grid-column: 1 / -1;
  }
  .kpis dt {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .kpis dd {
    margin: 0;
    font-size: var(--fs-md);
  }
  .kpis .main dd {
    font-size: var(--fs-lg);
  }
  .rows,
  .positions {
    list-style: none;
    display: grid;
  }
  .positions-card {
    padding-left: 0;
    padding-right: 0;
  }
  .positions-card h2,
  .positions-card p {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }
  .table-head {
    display: none;
  }
  @media (min-width: 768px) {
    .table-head {
      display: grid;
      grid-template-columns: 2fr 1.4fr 1.4fr 1fr 1.2fr;
      gap: 2px var(--space-3);
      padding: var(--space-2) var(--space-4);
      border-bottom: 1px solid var(--border);
      font-size: var(--fs-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .table-head .num {
      text-align: right;
    }
  }
  .rows li + li {
    border-top: 1px solid var(--border);
  }
  .position {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap);
    padding: var(--space-2) 0;
    color: inherit;
    text-decoration: none;
  }
  .rows .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .rows .side {
    display: grid;
    gap: 2px;
    justify-items: end;
    text-align: right;
    flex-shrink: 0;
  }
  .checks {
    list-style: none;
    display: grid;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: var(--space-2);
    background: var(--fg-muted);
  }
  .dot.ok {
    background: var(--gain);
  }
  .dot.warn {
    background: var(--warn);
  }
  .warn {
    color: var(--warn);
    font-weight: 600;
  }
  @media (max-width: 480px) {
    .trio {
      grid-template-columns: 1fr;
    }
  }
  @media (min-width: 768px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  /* Le rapport se rejoint au pied de la carte qui montre ce qu'il consolide, et non depuis un
     menu : même règle que le rapport de patrimoine sur la Vue d'ensemble (décision n° 178). */
  .report-link {
    justify-self: start;
    font-weight: 600;
    color: var(--accent);
    text-decoration: none;
  }
  .report-link:hover {
    text-decoration: underline;
  }
</style>
