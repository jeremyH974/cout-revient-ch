<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtDate, fmtMoney } from '$lib/format/fr';
  import { rateLookup } from '$lib/fx/convert';
  import { periodWindow, sliceSeries, todayOf, type Period } from '$lib/history';
  import { msToParisDay } from '$lib/import/time';
  import {
    hasUnavailable,
    latestNetWorth,
    netWorthSeries,
    tradingEquityContribution,
    valueSeriesContribution,
    type Contribution,
    type NetWorthPoint,
  } from '$lib/history/net-worth';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import Info from '../shared/Info.svelte';
  import EvolutionChart, { type ChartPoint } from './EvolutionChart.svelte';
  import PeriodToggle from './PeriodToggle.svelte';

  let period = $state<Period>('1m');
  onMount(() => void history.ensure());

  const today = $derived(todayOf(nowMs()));
  const investPoints = $derived(history.dailySeries('portfolio'));

  /**
   * Les producteurs de valeur. Les avoirs d'investissement viennent du grand livre au pas
   * quotidien ; chaque compte de trading vient de la plateforme, rééchantillonné au jour. Demain,
   * P36 (actif valorisé) et P41 (actions, ETF) ajouteront un producteur ici, et rien d'autre ne
   * bougera — c'est la raison d'être de cette forme.
   */
  const contributions = $derived.by((): Contribution[] => {
    const list: Contribution[] = [
      valueSeriesContribution('invest', 'Investissement', investPoints),
    ];
    const usd = rateLookup(app.state.fx.rates.USD ?? {});
    for (const account of app.hlAccounts) {
      const data = app.state.hyperliquid.accounts[account.id];
      const series = data?.portfolio?.['allTime'];
      if (!series || series.accountValueHistory.length === 0) continue;
      const equity = data?.snapshot?.perps.accountValue ?? null;
      list.push(
        tradingEquityContribution({
          id: account.id,
          label: account.label,
          history: series.accountValueHistory,
          dayOfMs: msToParisDay,
          // Même unité que le côté Investissement, que `pricesFor` a déjà converti dans la devise
          // d'affichage : en dollars il ne faut PAS diviser. Même règle qu'à `Trading.svelte:105`.
          usdPerDisplay: (day) => (app.currency === 'USD' ? '1' : usd.rate(day)),
          // L'instantané est plus frais que la dernière clôture servie par `portfolio` : sans ce
          // remplacement, le dernier point divergerait du total affiché dans le bandeau.
          live: equity === null ? null : { day: today, usd: equity },
        }),
      );
    }
    return list;
  });

  const series = $derived<NetWorthPoint[]>(
    investPoints.length === 0
      ? []
      : netWorthSeries({ contributions, days: investPoints.map((p) => p.day) }),
  );
  const window = $derived(periodWindow(period, today));
  const visible = $derived(
    sliceSeries(series, { from: window.from ?? series[0]?.day ?? today, to: window.to }),
  );

  /**
   * Courbe principale : la valeur nette. Courbe secondaire : les apports nets cumulés. L'écart
   * entre les deux EST le gain — c'est ce qui distingue cette courbe d'un solde de compte, où un
   * virement ressemble à une performance.
   */
  const points = $derived<ChartPoint[]>(
    visible.map((p) => ({
      day: p.day,
      primary: Number(p.net.toFixed(2)),
      secondary: Number(p.contributed.toFixed(2)),
      estimated: p.estimated.length > 0,
    })),
  );

  const latest = $derived(latestNetWorth(visible));
  const incomplete = $derived(hasUnavailable(visible));
  const tradingCount = $derived(contributions.length - 1);
</script>

<section class="card group" aria-labelledby="net-worth-title">
  <header>
    <h2 id="net-worth-title">Évolution de la valeur nette</h2>
    <Info title="Évolution de la valeur nette"
      >Ce que vous possédez, jour après jour, investissement et trading réunis. La courbe claire est
      le total de vos apports : l'écart entre les deux est votre gain. Un virement déplace les deux
      courbes ensemble et ne ressemble donc jamais à une performance.</Info
    >
  </header>

  {#if points.length === 0}
    <p class="empty">Importez un export ou synchronisez un compte pour voir votre valeur nette.</p>
  {:else}
    <PeriodToggle bind:value={period} />
    <EvolutionChart
      {points}
      currency={app.currency}
      discreet={app.state.ui.discreet}
      colorMode="vsSecondary"
      labels={{ primary: 'Valeur nette', secondary: 'Apports nets' }}
    />
    {#if latest}
      <!--
        Équivalent textuel du graphique : un tracé SVG seul n'est lisible par personne au lecteur
        d'écran. C'est aussi l'ancrage du contrôle de cohérence — ce montant doit égaler, au
        centime, la « Valeur nette » du bandeau ci-dessus.
      -->
      <p class="summary" data-testid="net-worth-latest">
        Au {fmtDate(latest.day)}, valeur nette
        <strong data-testid="net-worth-latest-value">{fmtMoney(latest.net, app.currency)}</strong>,
        pour <strong>{fmtMoney(latest.contributed, app.currency)}</strong> d'apports nets.
      </p>
    {/if}
    <p class="legend">
      {#if tradingCount > 0}
        Investissement + {tradingCount} compte{tradingCount > 1 ? 's' : ''} de trading. L'équité de trading
        est ramenée à un point par jour : la courbe de l'écran Trading, non amincie, reste la référence
        pour lire un épisode violent.
      {:else}
        Espace Investissement seul — aucun compte de trading synchronisé.
      {/if}
    </p>
    {#if incomplete}
      <p class="warn" role="status">
        Certains jours sont <strong>incomplets</strong> : un compte n'a pas pu être converti en euros
        faute de taux de change. Le total affiché est donc trop bas sur ces jours-là, et non approché.
        Actualisez les taux depuis les réglages.
      </p>
    {/if}
  {/if}
</section>

<style>
  .group {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
  }
  .summary {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .empty,
  .legend {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .warn {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
    border-left: 3px solid var(--warn, var(--border));
    padding-left: var(--space-3);
  }
</style>
