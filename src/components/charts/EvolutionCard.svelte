<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { ZERO, type Big } from '$lib/domain/money';
  import { seriesToCsv } from '$lib/export/csv-export';
  import { downloadText } from '$lib/export/download';
  import { fmtMoney, fmtPct, fmtPoints, fmtPrice } from '$lib/format/fr';
  import { periodPerformance, periodWindow, sliceSeries, todayOf, type Period } from '$lib/history';
  import {
    METRIC_SPECS,
    type Metric,
    type MetricPoint,
    availableMetrics,
    defaultMetric,
    metricSeries,
  } from '$lib/history/metrics';
  import { app } from '../../state/app.svelte';
  import { history, type Scope } from '../../state/history.svelte';
  import Info from '../shared/Info.svelte';
  import EvolutionChart, { type ChartMarker } from './EvolutionChart.svelte';
  import PeriodToggle from './PeriodToggle.svelte';

  let { scope = 'portfolio', title = 'Évolution' }: { scope?: Scope; title?: string } = $props();
  let period = $state<Period>('1m');
  const metrics = $derived(availableMetrics(scope === 'portfolio' ? 'portfolio' : 'asset'));
  const stored = $derived(
    scope === 'portfolio' ? app.state.ui.chartMetric : app.state.ui.assetChartMetric,
  );
  const metric = $derived<Metric>(
    metrics.includes(stored)
      ? stored
      : defaultMetric(scope === 'portfolio' ? 'portfolio' : 'asset'),
  );
  const chooseMetric = (m: Metric): void =>
    app.setUi(scope === 'portfolio' ? { chartMetric: m } : { assetChartMetric: m });
  const spec = $derived(METRIC_SPECS[metric]);

  onMount(() => void history.ensure());
  /** Période 1J : chargement immédiat, puis contrôle chaque minute (rechargement au-delà de 10 min). */
  $effect(() => {
    if (period !== '1d') return;
    const assets = scope === 'portfolio' ? app.heldAssets : [scope];
    void history.ensureIntraday(assets);
    const timer = setInterval(() => void history.ensureIntraday(assets), 60_000);
    return () => clearInterval(timer);
  });

  const today = $derived(todayOf(nowMs()));
  const window = $derived(periodWindow(period, today));
  const daily = $derived(history.metricPoints(scope));
  const visibleDaily = $derived(
    sliceSeries(daily, { from: window.from ?? daily[0]?.day ?? today, to: window.to }),
  );
  const visible = $derived<MetricPoint[]>(
    period === '1d' ? history.intradayMetricPoints(scope) : visibleDaily,
  );
  const points = $derived(metricSeries(visible, metric));
  const perf = $derived(
    period === '1d'
      ? null
      : periodPerformance(
          visibleDaily.map((p) => ({ day: p.day, value: p.value, cost: p.cost, missing: [] })),
          history.flows(scope),
        ),
  );
  const last = $derived(visible[visible.length - 1] ?? null);
  const first = $derived(visible[0] ?? null);
  const discreet = $derived(app.state.ui.discreet);
  /** Vrai si le dernier point reflète la cotation courante (sinon : dernière clôture connue). */
  const live = $derived(period === '1d' || history.lastPointIsLive(scope));
  const closeNote = $derived(live ? '' : ' (dernière clôture)');
  const money = (v: Big | null, opts?: { sign?: boolean }): string =>
    v === null || discreet ? '—' : fmtMoney(v, app.currency, opts);
  const latent = (p: MetricPoint | null): Big | null => (p ? p.value.minus(p.cost) : null);
  const latentPct = (p: MetricPoint | null): Big | null =>
    p && p.cost.gt(ZERO) ? p.value.minus(p.cost).div(p.cost) : null;
  const pru = (p: MetricPoint | null): Big | null =>
    p && p.qty && p.qty.gt(ZERO) ? p.cost.div(p.qty) : null;
  const tone = (v: Big | null): string =>
    v === null ? '' : v.lt('0') ? 'loss' : v.gt('0') ? 'gain' : '';
  /** Premier et dernier points réellement tracés pour la métrique (jours omis exclus). */
  const plotted = $derived.by((): { a: MetricPoint | null; b: MetricPoint | null } => {
    const defined =
      metric === 'unrealizedPct'
        ? visible.filter((p) => p.cost.gt(ZERO))
        : metric === 'pru'
          ? visible.filter((p) => p.price !== null)
          : visible;
    return { a: defined[0] ?? null, b: defined[defined.length - 1] ?? null };
  });
  /** Variation sur la période, en Big depuis les points (jamais de soustraction flottante). */
  const delta = $derived.by((): Big | null => {
    if (!first || !last) return null;
    if (metric === 'value')
      return period === '1d' ? last.value.minus(first.value) : (perf?.gain ?? null);
    const { a, b } = plotted;
    if (!a || !b || a === b) return null;
    if (metric === 'unrealized') return b.value.minus(b.cost).minus(a.value.minus(a.cost));
    if (metric === 'unrealizedPct')
      return b.value.minus(b.cost).div(b.cost).minus(a.value.minus(a.cost).div(a.cost));
    const lastPru = pru(last);
    return last.price && lastPru ? last.price.minus(lastPru) : null;
  });
  /** Achats et ventes de l'actif dont le jour tombe dans la fenêtre affichée. */
  const markers = $derived.by((): ChartMarker[] => {
    if (scope === 'portfolio' || period === '1d' || visible.length === 0) return [];
    const from = visible[0]!.day;
    const to = visible[visible.length - 1]!.day;
    return history.allPositions
      .filter((p) => p.asset === scope)
      .flatMap((p) => p.history)
      .filter((h) => h.kind === 'buy' || h.kind === 'sell')
      .map(
        (h) => ({ day: h.at.slice(0, 10), kind: h.kind === 'buy' ? 'buy' : 'sell' }) as ChartMarker,
      )
      .filter((m) => m.day >= from && m.day <= to);
  });
  const loadingIntraday = $derived(
    period === '1d' && Object.values(history.intradayLoading).some(Boolean),
  );
  const errors = $derived(history.status.errors);
  function exportCsv(): void {
    downloadText(
      `cout-revient-ch-evolution-${scope}-${today}.csv`,
      seriesToCsv(visible, app.currency),
      'text/csv;charset=utf-8',
    );
  }
</script>

<section class="card evolution" aria-label={title}>
  <div class="top">
    <h2 class="title">{title}</h2>
    <div class="metrics" role="radiogroup" aria-label="Grandeur tracée">
      {#each metrics as m (m)}
        <button
          type="button"
          role="radio"
          aria-checked={metric === m}
          class:active={metric === m}
          onclick={() => chooseMetric(m)}>{METRIC_SPECS[m].label}</button
        >
      {/each}
    </div>
  </div>
  <header>
    <div class="kpis">
      {#if metric === 'value'}
        <div>
          <p class="label">
            {scope === 'portfolio'
              ? 'Valeur des avoirs'
              : `Valeur de vos ${scope.toUpperCase()}`}{closeNote}
          </p>
          <p class="big">{money(last?.value ?? null)}</p>
        </div>
        <div>
          <p class="label">
            Performance <Info title="Performance de la période"
              ><p>
                Variation de la valeur sur la période <strong>hors apports et retraits</strong> : ce que
                le marché a fait gagner ou perdre, indépendamment de l'argent ajouté ou retiré entre-temps.
              </p>
              <p>
                Le pourcentage rapporte ce gain au capital moyen de la période (méthode de Dietz
                modifiée) : la valeur de départ plus chaque apport, compté au prorata du temps qu'il
                lui restait dans la période. Un retrait compte négativement de la même façon.
              </p>
              <p>
                La courbe grise en pointillé est le capital investi. Un actif sans aucune cotation
                connue est compté à son coût (courbe neutre, « estimé ») tant que son prix manque.
              </p></Info
            >
          </p>
          <p class="big {tone(delta)}">
            {money(delta, { sign: true })}
            {#if perf !== null && perf.pct !== null}<span class="pct"
                >{perf.pct.lt('0') ? '↘' : '↗'} {fmtPct(perf.pct)}</span
              >{/if}
          </p>
        </div>
      {:else if metric === 'unrealized'}
        <div>
          <p class="label">Plus-value latente{closeNote}</p>
          <p class="big {tone(latent(last))}">{money(latent(last), { sign: true })}</p>
        </div>
        <div>
          <p class="label">Variation sur la période</p>
          <p class="big {tone(delta)}">{money(delta, { sign: true })}</p>
        </div>
      {:else if metric === 'unrealizedPct'}
        <div>
          <p class="label">Latent vs investi{closeNote}</p>
          <p class="big {tone(latentPct(last))}">{fmtPct(latentPct(last))}</p>
        </div>
        <div>
          <p class="label">Variation sur la période</p>
          <p class="big {tone(delta)}">{fmtPoints(delta)}</p>
        </div>
      {:else}
        <div>
          <p class="label">{live ? 'Prix actuel' : 'Dernier prix (clôture)'}</p>
          <p class="big">{last?.price ? fmtPrice(last.price, app.currency) : '—'}</p>
        </div>
        <div>
          <p class="label">
            PRU <Info title="PRU vs prix"
              ><p>
                Le trait plein accentué est votre prix de revient unitaire (PRU). Quand le prix est
                au-dessus, la zone entre les deux est verte : vos unités sont en gain latent ; en
                dessous, elle est rouge. Les courbes elles-mêmes restent neutres.
              </p>
              <p>
                Les points marquent vos achats (vert) et ventes (rouge) tombant dans la période
                affichée, placés sur le prix de clôture du jour.
              </p></Info
            >
          </p>
          <p class="big {tone(delta)}">
            {pru(last) ? fmtPrice(pru(last), app.currency) : '—'}
            <span class="pct"
              >{delta && pru(last)
                ? `${delta.lt('0') ? '↘' : '↗'} ${fmtPct(delta.div(pru(last)!))}`
                : ''}</span
            >
          </p>
        </div>
      {/if}
    </div>
    <PeriodToggle bind:value={period} />
  </header>
  {#if scope !== 'portfolio' && metric !== 'pru' && last}
    <p class="muted small">
      PRU {pru(last) ? fmtPrice(pru(last), app.currency) : '—'} · prix {last.price
        ? fmtPrice(last.price, app.currency)
        : '—'}{#if last.price && pru(last)}
        · écart <span class={tone(last.price.minus(pru(last)!))}
          >{fmtPct(last.price.minus(pru(last)!).div(pru(last)!))}</span
        >{/if}
    </p>
  {/if}
  {#if history.status.loading}
    <p class="muted small">
      Chargement de l'historique des prix… {history.status.done}/{history.status.total}
    </p>
  {:else if loadingIntraday}
    <p class="muted small">Chargement des prix des dernières 24 h…</p>
  {/if}
  <EvolutionChart
    {points}
    format={spec.format}
    currency={app.currency}
    {markers}
    {discreet}
    zeroLine={spec.zeroLine}
    colorMode={spec.colorMode}
    band={spec.band}
    labels={{ primary: spec.primaryLabel, secondary: spec.secondaryLabel }}
  />
  <footer class="muted small">
    <span>
      {#if history.status.sources.length > 0}Sources : {history.status.sources.join(', ')}.{/if}
      {#if history.status.missing.length > 0}Sans historique : {history.status.missing
          .map((a) => a.toUpperCase())
          .join(', ')}.{/if}
      {#if history.status.partial.length > 0}Historique partiel : {history.status.partial
          .map((a) => a.toUpperCase())
          .join(', ')}.{/if}
      {#if errors.length > 0}<span class="warn"
          >{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1})` : ''}</span
        >{/if}
    </span>
    <button class="link" type="button" onclick={exportCsv} disabled={visible.length === 0}
      >Télécharger la série (CSV)</button
    >
  </footer>
</section>

<style>
  .evolution {
    margin: var(--space-3);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }
  .title {
    font-size: var(--fs-lg);
  }
  .metrics {
    display: flex;
    gap: 4px;
    background: var(--bg-sunken);
    border-radius: 999px;
    padding: 3px;
  }
  .metrics button {
    min-height: 32px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--fg-muted);
  }
  .metrics button.active {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: var(--shadow);
  }
  header {
    display: grid;
    gap: var(--space-3);
  }
  .kpis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    display: flex;
    align-items: center;
  }
  .big {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .pct {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  footer {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
    font-size: var(--fs-xs);
  }
  .link:disabled {
    opacity: 0.5;
  }
  @media (min-width: 768px) {
    header {
      grid-template-columns: 1fr auto;
      align-items: start;
    }
    .big {
      font-size: var(--fs-xl);
    }
  }
</style>
