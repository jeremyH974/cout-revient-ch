<script lang="ts">
  /**
   * Statistiques de trading (P22) : espérance (devise et R), taux de réussite, profit factor,
   * drawdown, séries, ventilations par setup / actif / sens / jour / heure / durée. Standards de
   * praticiens, jamais prédictifs : sous 30 trades clos, un avertissement remplace tout verdict.
   *
   * Un sélecteur de période (le même qu'à la Vue d'ensemble) restreint tous ces chiffres aux
   * aller-retours **clos dans la fenêtre** ; « Tout » est le défaut. Le calendrier, lui, garde sa
   * propre navigation et ses trois mailles : il ne suit pas le sélecteur (décision n° 95).
   */
  import { nowMs } from '$lib/clock';
  import type { Big } from '$lib/domain/money';
  import type { JournaledTrip } from '$lib/domain/trading/journal';
  import {
    computeStats,
    statsBuckets,
    tripsClosedIn,
    MIN_SAMPLE,
    type StatsDimension,
  } from '$lib/domain/trading/stats';
  import { fmtPct } from '$lib/format/fr';
  import { periodWindow, todayOf, type Period } from '$lib/history';
  import PeriodToggle from '../../components/charts/PeriodToggle.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import PnlCalendar from '../../components/trading/PnlCalendar.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  const toDisplay = (t: JournaledTrip, value: Big): Big | null =>
    app.quoteToDisplay(t.trip.quote, value);

  const PERIOD_LABEL: Record<Period, string> = {
    '1d': 'sur 1 jour',
    '1w': 'sur 1 semaine',
    '1m': 'sur 1 mois',
    '3m': 'sur 3 mois',
    '1y': 'sur 1 an',
    all: 'sur tout l’historique',
  };
  /** « 1 jour » n'a aucun sens pour des statistiques : mêmes périodes que la Vue d'ensemble. */
  const PERIODS: Period[] = ['1w', '1m', '3m', '1y', 'all'];
  let period = $state<Period>('all');
  // Pas `window` : le nom est déjà celui de l'objet global.
  const dayWindow = $derived(periodWindow(period, todayOf(nowMs())));
  const scoped = $derived(tripsClosedIn(app.roundTrips, dayWindow));
  const stats = $derived(computeStats(scoped, toDisplay));
  /** Y a-t-il de quoi faire des statistiques, périodes confondues ? (sinon : écran d'accueil vide) */
  const anyClosed = $derived(app.roundTrips.some((t) => t.trip.status === 'closed'));

  const DIMENSIONS: { id: StatsDimension; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'symbol', label: 'Actif' },
    { id: 'direction', label: 'Sens' },
    { id: 'weekday', label: 'Jour de la semaine' },
    { id: 'hour', label: "Heure d'entrée" },
    { id: 'duration', label: 'Durée de détention' },
    { id: 'account', label: 'Compte' },
  ];
  let dimension = $state<StatsDimension>('setup');
  const buckets = $derived(
    statsBuckets(scoped, dimension, toDisplay, (key) => app.accountLabels[key] ?? key),
  );

  const ratio = (value: Big | null): string =>
    value === null ? '—' : value.toFixed(2).replace('.', ',');

  /**
   * P27 : résumé anonymisé à coller dans l'IA de son choix — ratios, R et compteurs seulement,
   * jamais un montant, un actif précis restant identifiable ni une adresse.
   */
  function anonymousSummary(): string {
    const lines = [
      'Voici mes statistiques de trading (résumé anonymisé, sans montants). Analyse ce qui marche, ce qui ne marche pas, et propose 3 axes de travail concrets.',
      '',
      `Période : ${PERIOD_LABEL[period].replace(/^sur /, '')}${dayWindow.from === null ? '' : ` (trades clos du ${dayWindow.from} au ${dayWindow.to})`}`,
      `Trades clos : ${stats.closed} (gagnés ${stats.wins}, perdus ${stats.losses}, neutres ${stats.breakeven})${stats.smallSample ? ' — échantillon < 30, prudence' : ''}`,
      `Taux de réussite : ${stats.winRate === null ? 'n/a' : fmtPct(stats.winRate, { sign: false })}`,
      `Profit factor : ${ratio(stats.profitFactor)} · Payoff (gain moyen / perte moyenne) : ${ratio(stats.payoff)}`,
      `Espérance : ${stats.expectancyR === null ? 'n/a' : `${ratio(stats.expectancyR)} R`} (${stats.nR} trades avec plan)`,
      `Plus longue série de gains : ${stats.longestWinStreak} · de pertes : ${stats.longestLossStreak}`,
      `Durée moyenne de détention : ${duration(stats.avgHoldSeconds)}`,
      '',
      'Par setup (n, réussite, R moyen) :',
      ...statsBuckets(scoped, 'setup', toDisplay).map(
        (b) =>
          `- ${b.label} : n=${b.stats.closed}, réussite ${b.stats.winRate === null ? 'n/a' : fmtPct(b.stats.winRate, { sign: false })}, ${b.stats.expectancyR === null ? 'R n/a' : `${ratio(b.stats.expectancyR)} R`}`,
      ),
      'Par sens :',
      ...statsBuckets(scoped, 'direction', toDisplay).map(
        (b) =>
          `- ${b.label} : n=${b.stats.closed}, réussite ${b.stats.winRate === null ? 'n/a' : fmtPct(b.stats.winRate, { sign: false })}`,
      ),
    ];
    return lines.join('\n');
  }

  async function copySummary(): Promise<void> {
    try {
      await navigator.clipboard.writeText(anonymousSummary());
      toasts.push('Résumé copié : collez-le dans l’IA de votre choix.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }
  const rText = (value: Big | null): string => (value === null ? '—' : `${ratio(value)} R`);
  function duration(seconds: number | null): string {
    if (seconds === null) return '—';
    if (seconds < 3_600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86_400) return `${Math.round(seconds / 3_600)} h`;
    return `${(seconds / 86_400).toFixed(1).replace('.', ',')} j`;
  }
</script>

<AppBar title="Statistiques" back={{ name: 'trading' }} />
<TradingTabs active="tradeStats" />

{#if !anyClosed}
  <section class="card">
    <p class="muted">
      Aucun trade clos pour l'instant : les statistiques apparaîtront après vos premiers
      aller-retours (synchronisation Hyperliquid ou saisie manuelle).
    </p>
  </section>
{:else}
  <!-- La période gouverne tout l'écran sauf le calendrier, qui a sa propre navigation. -->
  <div class="period-bar">
    <span class="muted small">Période</span>
    <PeriodToggle bind:value={period} available={PERIODS} />
  </div>

  {#if stats.closed === 0}
    <section class="card">
      <p class="muted">
        Aucun trade clos {PERIOD_LABEL[period]} — élargissez la période. Les positions encore ouvertes
        n'entrent dans aucune statistique : elles n'ont pas encore de résultat.
      </p>
    </section>
  {:else}
    {#if stats.smallSample}
      <p class="card warn-card" role="note">
        <strong>Échantillon trop petit</strong> : {stats.closed} trade{stats.closed > 1 ? 's' : ''}
        clos sur les {MIN_SAMPLE} nécessaires pour qu'une tendance veuille dire quelque chose. Ces chiffres
        décrivent le passé, ils ne prédisent rien.
      </p>
    {/if}

    <section class="card">
      <h2>
        Vue d'ensemble ({stats.closed} trade{stats.closed > 1 ? 's' : ''} clos{period === 'all'
          ? ''
          : ` ${PERIOD_LABEL[period]}`})
      </h2>
      <dl class="kpis">
        <div class="main">
          <dt>Espérance par trade</dt>
          <dd>
            <Money value={stats.expectancy} sign colored strong />
            <span class="muted small"
              >{stats.nR > 0 ? `· ${rText(stats.expectancyR)} (${stats.nR} avec plan)` : ''}</span
            >
          </dd>
        </div>
        <div>
          <dt>Taux de réussite</dt>
          <dd class="num">
            {stats.winRate === null ? '—' : fmtPct(stats.winRate, { sign: false })}
          </dd>
        </div>
        <div>
          <dt>Profit factor</dt>
          <dd class="num">{ratio(stats.profitFactor)}</dd>
        </div>
        <div>
          <dt>Gain moyen / perte moyenne</dt>
          <dd>
            <Money value={stats.avgWin} compact /> / <Money value={stats.avgLoss} compact />
          </dd>
        </div>
        <div>
          <dt>Payoff</dt>
          <dd class="num">{ratio(stats.payoff)}</dd>
        </div>
        <div>
          <!-- Explicitement « des trades CLOS » : le tableau de bord et le calendrier, eux, comptent
             aussi ce qu'une position encore ouverte a déjà réalisé. Deux chiffres légitimement
             différents, qu'un libellé vague ferait passer pour une contradiction. -->
          <dt>P&L net des trades clos</dt>
          <dd><Money value={stats.netTotal} sign colored /></dd>
        </div>
        <div>
          <dt>Drawdown max (cumul)</dt>
          <dd>
            <Money
              value={stats.maxDrawdown === null ? null : stats.maxDrawdown.neg()}
              sign
              colored
            />
          </dd>
        </div>
        <div>
          <dt>Meilleur / pire</dt>
          <dd><Money value={stats.best} compact /> / <Money value={stats.worst} compact /></dd>
        </div>
        <div>
          <dt>Séries (gains / pertes)</dt>
          <dd class="num">{stats.longestWinStreak} / {stats.longestLossStreak}</dd>
        </div>
        <div>
          <dt>Durée moyenne</dt>
          <dd class="num">{duration(stats.avgHoldSeconds)}</dd>
        </div>
        <div>
          <dt>Frais + funding</dt>
          <dd>
            <Money value={stats.feesTotal.neg()} sign colored compact />
            · <Money value={stats.fundingTotal} sign colored compact />
          </dd>
        </div>
        <div>
          <dt>Gagnés / perdus / neutres</dt>
          <dd class="num">{stats.wins} / {stats.losses} / {stats.breakeven}</dd>
        </div>
      </dl>
      {#if stats.excluded > 0}
        <p class="muted small">
          {stats.excluded} trade{stats.excluded > 1 ? 's' : ''} dans une autre devise sans taux de conversion
          : compté{stats.excluded > 1 ? 's' : ''} dans les taux de réussite, pas dans les montants.
        </p>
      {/if}
    </section>
  {/if}

  <section class="card">
    <h2>Calendrier de P&L</h2>
    {#if period !== 'all'}
      <p class="muted small">
        Le calendrier ne suit pas le filtre de période : il a sa propre navigation, et ses trois
        mailles (jour, mois, année).
      </p>
    {/if}
    <PnlCalendar trips={app.roundTrips} events={app.realized} />
  </section>

  {#if stats.closed > 0}
    <section class="card">
      <div class="head">
        <h2>Ce qui marche (ou pas)</h2>
        <label class="field"
          ><span class="sr-only">Ventiler par</span>
          <select bind:value={dimension} aria-label="Ventiler par">
            {#each DIMENSIONS as d (d.id)}
              <option value={d.id}>{d.label}</option>
            {/each}
          </select>
        </label>
      </div>
      <!-- Un tableau qui défile horizontalement doit rester accessible au clavier (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="scroll" tabindex="0" role="region" aria-label="Répartition — tableau défilant">
        <table>
          <thead>
            <tr>
              <th scope="col">{DIMENSIONS.find((d) => d.id === dimension)?.label}</th>
              <th scope="col" class="num">Trades</th>
              <th scope="col" class="num">Réussite</th>
              <th scope="col" class="num">Espérance</th>
              <th scope="col" class="num">R moyen</th>
              <th scope="col" class="num">P&L net</th>
            </tr>
          </thead>
          <tbody>
            {#each buckets as bucket (bucket.key)}
              <tr>
                <th scope="row">{bucket.label}</th>
                <td class="num"
                  >{bucket.stats.closed}{bucket.stats.open > 0
                    ? ` (+${bucket.stats.open})`
                    : ''}</td
                >
                <td class="num"
                  >{bucket.stats.winRate === null
                    ? '—'
                    : fmtPct(bucket.stats.winRate, { sign: false })}</td
                >
                <td class="num"><Money value={bucket.stats.expectancy} sign colored compact /></td>
                <td class="num">{rText(bucket.stats.expectancyR)}</td>
                <td class="num"><Money value={bucket.stats.netTotal} sign colored compact /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small">
        Une ligne avec moins d'une dizaine de trades ne prouve rien — c'est une piste à surveiller,
        pas un verdict.
      </p>
    </section>

    <section class="card">
      <h2>Faire relire mes statistiques</h2>
      <p class="muted small">
        Copie un résumé <strong>anonymisé</strong> (ratios, R, compteurs — jamais un montant ni une adresse),
        sur la période affichée, à coller dans l'assistant IA de votre choix. Rien n'est envoyé nulle
        part par l'application.
      </p>
      <button class="secondary" type="button" onclick={() => void copySummary()}
        >Copier un résumé anonymisé</button
      >
    </section>
  {/if}
{/if}

<style>
  .warn-card {
    border-left: 4px solid var(--warn);
    margin-bottom: var(--space-3);
  }
  .period-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  .secondary {
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--fs-md);
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
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .head h2 {
    margin: 0;
  }
  .scroll {
    overflow-x: auto;
  }
  .scroll:focus-visible {
    outline: 2px solid var(--accent-trading);
    outline-offset: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th.num,
  td.num {
    text-align: right;
  }
  thead th {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  @media (min-width: 768px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
