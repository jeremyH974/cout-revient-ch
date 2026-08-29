<script lang="ts">
  import { orderedIndicators } from '$lib/macro';
  import type { MacroIndicator } from '$lib/macro';
  import { WINDOWS, correlate, type PairCorrelation } from '$lib/macro/correlation';
  import { firstCommonDay, overlayGeometry, rebase } from '$lib/macro/overlay';
  import { fromCompact, type DayValue } from '$lib/macro/stats';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';

  /**
   * Le seul endroit de l'application où le contexte de marché rencontre *vos* chiffres.
   *
   * La série confrontée aux indicateurs n'est pas le cours du bitcoin mais **l'indice de rendement
   * pondéré temps de votre portefeuille** : apports et retraits neutralisés par construction, donc
   * comparable à une série de marché. Comparer la valeur brute — qui monte parce qu'on y verse de
   * l'argent — à un indice sans apports est une erreur documentée, et fabriquerait une
   * surperformance qui n'existe pas.
   *
   * Rien n'est calculé sans que vous le demandiez : l'historique de prix nécessaire n'est pas
   * chargé d'office depuis cet écran, qui promet par ailleurs de ne rien demander au réseau.
   */

  let loading = $state(false);
  let showOverlay = $state(false);
  let overlayId = $state<string | null>(null);

  const ready = $derived(history.status.loadedAt !== null);

  /** Indice de rendement du portefeuille, base 1, un point par jour. */
  const portfolio = $derived.by((): DayValue[] => {
    if (!ready) return [];
    const twr = history.performance().twr;
    if (!twr.ok) return [];
    return twr.index.map((point) => ({ day: point.day, value: Number(point.index.toString()) }));
  });

  /**
   * Une corrélation glissante demande des variations quotidiennes. Une série hebdomadaire — les
   * réserves de la Fed — n'en fournit pas assez pour une fenêtre de trente jours : elle est écartée
   * plutôt que mesurée sur quatre points.
   */
  function isDaily(indicator: MacroIndicator): boolean {
    const points = fromCompact(indicator.series);
    if (points.length < 30) return false;
    const span = points.length;
    const covered = indicator.series.values.length;
    return covered / span < 2.5; // moins de 2,5 jours calendaires par observation ⇒ quotidienne
  }

  const pairs = $derived.by((): { indicator: MacroIndicator; result: PairCorrelation }[] => {
    if (portfolio.length < 40) return [];
    return orderedIndicators()
      .filter(isDaily)
      .map((indicator) => ({
        indicator,
        result: correlate(portfolio, fromCompact(indicator.series)),
      }))
      .filter((pair) => pair.result.correlations.length > 0);
  });

  const weeklySkipped = $derived(orderedIndicators().filter((i) => !isDaily(i)));

  const decimal = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  });
  const longDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
  const asUtcDay = (day: string): Date => new Date(`${day}T12:00:00Z`);

  /**
   * Comment lire l'écart entre fenêtres. Ce n'est pas un jugement sur l'indicateur : c'est la
   * mesure de la confiance qu'on peut accorder à un coefficient unique.
   */
  function stabilityLabel(spread: number | null): string {
    if (spread === null) return '';
    if (spread < 0.2) return 'les quatre fenêtres concordent';
    if (spread < 0.5) return 'les fenêtres divergent un peu';
    return 'les fenêtres se contredisent — aucun chiffre unique ne décrit cette relation';
  }

  const OVERLAY_WIDTH = 280;
  const OVERLAY_HEIGHT = 90;

  const overlayIndicator = $derived(
    pairs.find((pair) => pair.indicator.id === overlayId)?.indicator ?? pairs[0]?.indicator ?? null,
  );

  const overlay = $derived.by(() => {
    if (!showOverlay || !overlayIndicator || portfolio.length < 2) return null;
    const macro = fromCompact(overlayIndicator.series);
    const start = firstCommonDay(portfolio, macro);
    if (start === null) return null;
    const mine = rebase(portfolio, start);
    const theirs = rebase(macro, start);
    const geometry = overlayGeometry(mine, theirs, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    return geometry === null ? null : { geometry, start };
  });

  async function compute(): Promise<void> {
    loading = true;
    try {
      await history.ensure();
    } finally {
      loading = false;
    }
  }
</script>

<section class="card lens" aria-labelledby="lens-heading">
  <h2 id="lens-heading">Vos chiffres face au décor</h2>

  {#if !app.hasData}
    <p class="muted">
      Cette section confronte votre propre historique aux indicateurs ci-dessus. Elle apparaîtra une
      fois vos opérations importées.
    </p>
  {:else if !ready}
    <p class="muted">
      Pour mesurer si votre portefeuille bouge avec ces indicateurs, il faut son historique de
      valeur — donc les cours passés de vos actifs, que cet écran ne télécharge pas de lui-même.
    </p>
    <button class="secondary" type="button" onclick={compute} disabled={loading}>
      {loading ? 'Calcul en cours…' : 'Calculer à partir de mon historique'}
    </button>
  {:else if pairs.length === 0}
    <p class="muted">
      Votre historique est trop court pour une corrélation qui veuille dire quelque chose. Il en
      faut quelques mois.
    </p>
  {:else}
    <p class="muted lead">
      Corrélation entre les variations quotidiennes de <strong>votre rendement</strong> — apports et
      retraits neutralisés — et celles de chaque indicateur. Sur
      <strong>quatre fenêtres</strong>, jamais une seule : c'est leur désaccord qui informe, pas
      leur moyenne. Une corrélation n'est pas une causalité.
    </p>

    <ul class="pairs">
      {#each pairs as pair (pair.indicator.id)}
        <li>
          <h3>{pair.indicator.label}</h3>
          <p class="windows">
            {#each WINDOWS as window (window)}
              {@const found = pair.result.correlations.find((c) => c.windowDays === window)}
              <span class="window" class:absent={!found}>
                <span class="days">{window} j</span>
                <span class="coefficient">{found ? decimal.format(found.coefficient) : '—'}</span>
              </span>
            {/each}
          </p>
          <p class="muted small">
            {stabilityLabel(pair.result.spread)}{pair.result.spread !== null
              ? ` (écart ${pair.result.spread.toFixed(2)})`
              : ''}.
            {pair.result.correlations[0]?.observations ?? 0} jours communs sur la fenêtre la plus courte
            ;
            {pair.result.assetDaysDropped} jours écartés, faute de cotation de l'indicateur.
          </p>
        </li>
      {/each}
    </ul>

    {#if weeklySkipped.length > 0}
      <p class="muted small">
        Non mesuré : {weeklySkipped.map((i) => i.label).join(', ')} — publication hebdomadaire, trop peu
        de points pour une corrélation glissante honnête.
      </p>
    {/if}

    <label class="toggle">
      <input type="checkbox" bind:checked={showOverlay} />
      Superposer ma courbe de rendement à un indicateur
    </label>

    {#if showOverlay}
      <div class="overlay">
        <label class="picker">
          <span>Indicateur</span>
          <select bind:value={overlayId}>
            {#each pairs as pair (pair.indicator.id)}
              <option value={pair.indicator.id}>{pair.indicator.label}</option>
            {/each}
          </select>
        </label>

        {#if overlay && overlayIndicator}
          <svg
            width={OVERLAY_WIDTH}
            height={OVERLAY_HEIGHT}
            viewBox="0 0 {OVERLAY_WIDTH} {OVERLAY_HEIGHT}"
            role="img"
            aria-label="Rendement du portefeuille et {overlayIndicator.label}, ramenés à 100 au {longDate.format(
              asUtcDay(overlay.start),
            )}"
          >
            <line
              class="base"
              x1="0"
              y1={overlay.geometry.baseY}
              x2={OVERLAY_WIDTH}
              y2={overlay.geometry.baseY}
            />
            <path class="theirs" d={overlay.geometry.paths[1]} fill="none" />
            <path class="mine" d={overlay.geometry.paths[0]} fill="none" />
          </svg>
          <p class="legend">
            <span class="key mine-key"></span> mon rendement
            <span class="key theirs-key"></span>
            {overlayIndicator.label}
          </p>
          <p class="muted small">
            Les deux courbes valent <strong>100</strong> au {longDate.format(
              asUtcDay(overlay.start),
            )}, premier jour qu'elles ont en commun — pas une date choisie après coup — et partagent
            <strong>un seul axe</strong> : deux échelles indépendantes permettraient de les faire coïncider
            à volonté.
          </p>
        {:else}
          <p class="muted small">Pas assez de jours communs pour superposer ces deux courbes.</p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .lens {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    font-size: var(--fs-md);
  }
  h3 {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .muted {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .lead {
    margin-bottom: var(--space-1);
  }
  .pairs {
    list-style: none;
    display: grid;
    gap: var(--space-4);
  }
  .pairs li {
    display: grid;
    gap: var(--space-1);
  }
  .windows {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .window {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    font-variant-numeric: tabular-nums;
  }
  .window.absent {
    opacity: 0.55;
  }
  .days {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .coefficient {
    font-size: var(--fs-sm);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    min-height: var(--tap);
  }
  .overlay {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .base {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  /* Deux traits distingués par l'épaisseur et le pointillé, pas par la seule couleur. */
  .mine {
    stroke: var(--fg);
    stroke-width: 1.75;
    stroke-linejoin: round;
  }
  .theirs {
    stroke: var(--fg-muted);
    stroke-width: 1.25;
    stroke-dasharray: 4 3;
    stroke-linejoin: round;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    flex-wrap: wrap;
  }
  .key {
    display: inline-block;
    width: 18px;
    height: 0;
    border-top-width: 2px;
    border-top-style: solid;
  }
  .mine-key {
    border-top-color: var(--fg);
  }
  .theirs-key {
    border-top-color: var(--fg-muted);
    border-top-style: dashed;
  }
</style>
