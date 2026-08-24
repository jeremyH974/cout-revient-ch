<script lang="ts">
  /**
   * Espace Trading — tableau de bord (P20, présentation alignée sur la synthèse Investissement) :
   * carte Synthèse (dépôts nets, équité, P&L total), courbe d'équité / P&L de la plateforme
   * (`portfolio`, persistée à la synchronisation), résultat par période, positions ouvertes
   * (chacune renvoie vers son aller-retour), avoirs spot, auto-vérification. Les fills vivent
   * dans leur propre onglet. Jamais de PRU ici ; montants USDC convertis au taux BCE du jour.
   */
  import { nowMs } from '$lib/clock';
  import { D, ZERO, type Big } from '$lib/domain/money';
  import { accountReport, totalsSince, type TradingTotals } from '$lib/domain/trading/compute';
  import { rateLookup } from '$lib/fx';
  import { fmtRelative } from '$lib/format/fr';
  import { msToParisNaive } from '$lib/import/time';
  import { router } from '$lib/router.svelte';
  import { DISCUSSIONS_URL } from '$lib/support/links';
  import EvolutionChart, { type ChartPoint } from '../components/charts/EvolutionChart.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import Info from '../components/shared/Info.svelte';
  import Money from '../components/shared/Money.svelte';
  import Qty from '../components/shared/Qty.svelte';
  import PositionRow from '../components/trading/PositionRow.svelte';
  import TradingTabs from '../components/trading/TradingTabs.svelte';
  import { app } from '../state/app.svelte';

  type Period = '7d' | '30d' | 'all';
  const PERIODS: { id: Period; label: string; days: number | null }[] = [
    { id: '7d', label: '7 jours', days: 7 },
    { id: '30d', label: '30 jours', days: 30 },
    { id: 'all', label: 'Tout', days: null },
  ];
  let period = $state<Period>('30d');
  let selected = $state<string>('all');

  const report = $derived(app.tradingReport);
  const accounts = $derived(app.hlAccounts);
  const current = $derived(selected === 'all' ? null : (accountReport(report, selected) ?? null));
  const scoped = $derived(current ? { ...report, accounts: [current] } : report);
  const since = $derived.by((): number => {
    const days = PERIODS.find((p) => p.id === period)?.days ?? null;
    return days === null ? 0 : nowMs() - days * 86_400_000;
  });
  const totals: TradingTotals = $derived(totalsSince(scoped, since));
  const allTotals: TradingTotals = $derived(totalsSince(scoped, 0));
  const equity = $derived(current ? (current.equity ?? ZERO) : report.equity);
  const unrealized = $derived(current ? current.unrealized : report.unrealized);
  /** P&L total = réalisé net (tout l'historique) + latent des positions ouvertes. */
  const totalPnl = $derived(allTotals.net.plus(unrealized));
  const money = (value: Big): Big | null => app.usdcToDisplay(value);
  const positions = $derived(scoped.accounts.flatMap((a) => a.snapshot?.positions ?? []));
  const holdings = $derived(scoped.accounts.flatMap((a) => a.snapshot?.spot ?? []));
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
  const holdingValue = (asset: string, qty: string): Big | null => {
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
  const curvePoints = $derived.by((): ChartPoint[] => {
    if (curveAccount === null) return [];
    const series = app.state.hyperliquid.accounts[curveAccount]?.portfolio?.[curvePeriod];
    if (!series) return [];
    const raw = curveMetric === 'equity' ? series.accountValueHistory : series.pnlHistory;
    const usd = rateLookup(app.state.fx.rates.USD ?? {});
    const points: ChartPoint[] = [];
    // Tous les points de la plateforme, sans amincissement : la courbe doit être exactement celle
    // du Portfolio Hyperliquid (l'écraser à un point par jour déforme les épisodes violents).
    for (const [ms, value] of raw) {
      const naive = msToParisNaive(ms);
      const rate = app.currency === 'USD' ? '1' : usd.rate(naive.slice(0, 10));
      if (rate === null || !D(rate).gt(ZERO)) continue;
      points.push({
        day: naive.slice(0, 16),
        primary: Number(D(value).div(rate).toFixed(6)),
        secondary: null,
      });
    }
    // Équité : référence = valeur au départ de la période → vert au-dessus, rouge en dessous.
    if (curveMetric === 'equity' && points.length > 0) {
      const start = points[0]!.primary;
      for (const point of points) point.secondary = start;
    }
    return points;
  });

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
          {#if app.state.ui.liveMids}
            <span
              class="dot {app.liveStatus}"
              role="status"
              aria-label={app.liveStatus === 'live'
                ? 'Prix en direct : connecté'
                : app.liveStatus === 'retry'
                  ? 'Prix en direct : reconnexion en cours'
                  : app.liveStatus === 'connecting'
                    ? 'Prix en direct : connexion…'
                    : 'Prix en direct : arrêté'}
            ></span>
          {/if}
        </label>
      </div>
    </div>
    <p class="muted small" aria-live="polite">
      {#if syncing}
        Lecture des fills, du funding et des mouvements…
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
        <p class="label">Équité</p>
        <p class="big"><Money value={money(equity)} compact strong /></p>
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
      <EvolutionChart
        points={curvePoints}
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
      />
      <p class="muted small">
        Courbe fournie par la plateforme ({label(curveAccount)}), convertie au taux BCE de chaque
        jour ; le P&L de la courbe est celui de la plateforme (période glissante).
      </p>
    {/if}
  </section>

  <section class="card">
    <div class="head">
      <h2>Résultat</h2>
      <div class="segments" role="group" aria-label="Période">
        {#each PERIODS as p (p.id)}
          <button
            type="button"
            class="segment"
            aria-pressed={period === p.id}
            onclick={() => (period = p.id)}>{p.label}</button
          >
        {/each}
      </div>
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
        Valorisés au dernier prix connu. Pour un PRU et des plus-values, cochez « traiter le spot
        comme de l'investissement » sur le compte (écran Comptes).
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
            {label(a.accountId)} : équité = dépôts nets + réalisé − frais + funding + latent.
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
</style>
