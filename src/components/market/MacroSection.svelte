<script lang="ts">
  import { MACRO, ageInDays, isStale, orderedIndicators, sparkGeometry } from '$lib/macro';
  import type { MacroIndicator } from '$lib/macro';

  /**
   * Les indicateurs macroéconomiques, chacun avec son rang historique.
   *
   * Trois règles gouvernent cet écran, et chacune se voit :
   *
   * 1. **Jamais une valeur sans son rang.** « Taux réel à 2,42 % » ne dit rien ; « 99ᵉ percentile
   *    sur dix ans » dit tout. Deux fenêtres sont affichées, parce qu'un percentile n'existe que
   *    relativement à la sienne — et qu'elles se contredisent parfois, ce qui est l'information.
   * 2. **La transformation est annoncée.** Classer le niveau d'une série qui monte tendanciellement
   *    donnerait 99 % en permanence ; ces séries sont donc converties en variation, et le libellé
   *    le dit (« sur 3 mois », « sur 12 mois »).
   * 3. **La couleur reste aux variances** (décision n° 56). Un niveau n'est ni bon ni mauvais : la
   *    sparkline montre une forme, le percentile donne le rang, rien n'est peint en rouge ou vert.
   */

  let { today }: { today: string } = $props();

  const indicators = orderedIndicators();

  const SPARK_WIDTH = 96;
  const SPARK_HEIGHT = 22;

  const decimal = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
  const longDate = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  /** `+` explicite sur les variations : sans lui, « 0,39 » ne dit pas dans quel sens. */
  const signed = (value: number): string =>
    value > 0 ? `+${decimal.format(value)}` : decimal.format(value);

  function formatValue(indicator: MacroIndicator): string {
    const isChange = indicator.transform !== 'level';
    const text = isChange ? signed(indicator.value) : decimal.format(indicator.value);
    switch (indicator.unit) {
      case 'percent':
        return `${text} %`;
      case 'percentPoints':
        return `${text} pt`;
      case 'usdBillions':
        return `${text} Md$`;
      default:
        return text;
    }
  }

  /** Ce qui a été fait à la série, dit en clair sous la valeur. */
  function transformLabel(indicator: MacroIndicator): string {
    switch (indicator.transform) {
      case 'change3m':
        return 'variation sur 3 mois';
      case 'yoy':
        return 'variation sur 12 mois';
      case 'volatility':
        return 'volatilité annualisée';
      default:
        return 'niveau';
    }
  }

  /** « 99ᵉ » — le rang se lit comme un classement, pas comme un pourcentage de quelque chose. */
  const ordinal = (percentile: number): string => {
    const rounded = Math.round(percentile);
    return `${rounded}${rounded === 1 ? 'ᵉʳ' : 'ᵉ'}`;
  };

  const WINDOW_LABELS: Record<string, string> = {
    '1y': 'sur 1 an',
    '5y': 'sur 5 ans',
    '10y': 'sur 10 ans',
  };
  const windowLabel = (window: string): string => WINDOW_LABELS[window] ?? window;

  const missing = $derived(MACRO.sources.filter((source) => source.missing !== undefined));
</script>

<section class="card regime" aria-labelledby="regime-heading">
  <h2 id="regime-heading">Régime macroéconomique</h2>
  <p class="muted lead">
    Chaque chiffre est accompagné de son <strong>rang</strong> dans son propre passé, sur deux fenêtres
    : une valeur seule ne dit pas si elle est haute ou basse. Ces indicateurs décrivent le décor, ils
    ne disent rien de votre portefeuille et ne recommandent rien.
  </p>

  <ul class="list">
    {#each indicators as indicator (indicator.id)}
      {@const spark = sparkGeometry(indicator.series, SPARK_WIDTH, SPARK_HEIGHT)}
      {@const stale = isStale(indicator, today)}
      <li>
        <div class="head">
          <h3>{indicator.label}</h3>
          <svg
            class="spark"
            width={SPARK_WIDTH}
            height={SPARK_HEIGHT}
            viewBox="0 0 {SPARK_WIDTH} {SPARK_HEIGHT}"
            aria-hidden="true"
            focusable="false"
          >
            {#if spark.zeroY !== null}
              <line class="zero" x1="0" y1={spark.zeroY} x2={SPARK_WIDTH} y2={spark.zeroY} />
            {/if}
            <path class="line" d={spark.path} fill="none" />
            {#if spark.last}<circle class="dot" cx={spark.last.x} cy={spark.last.y} r="2" />{/if}
          </svg>
        </div>

        <p class="value">
          <span class="number">{formatValue(indicator)}</span>
          {#if indicator.transform !== 'level'}
            <span class="muted small">{transformLabel(indicator)}</span>
          {/if}
        </p>

        <!--
          Le séparateur est un vrai texte, pas un `::before` en CSS : le contenu engendré par le
          style n'est pas restitué par tous les lecteurs d'écran, qui liraient alors « sur 1 an23ᵉ ».
        -->
        <p class="ranks">
          {#each indicator.ranks as rank, index (rank.window)}
            <span class="rank"
              >{index > 0 ? ' · ' : ''}{ordinal(rank.percentile)} percentile
              {windowLabel(rank.window)}</span
            >
          {/each}
        </p>

        <p class="muted small">
          {indicator.detail}
          <span class="asof" class:stale>
            Au {longDate.format(new Date(`${indicator.asOf}T12:00:00Z`))}{stale
              ? ` — pas de nouvelle publication depuis ${ageInDays(indicator, today)} jours`
              : ''}.
          </span>
          <a href={indicator.url} target="_blank" rel="noopener noreferrer">Source</a>
        </p>

        {#if indicator.caveat}
          <p class="muted small caveat">{indicator.caveat}</p>
        {/if}
      </li>
    {/each}
  </ul>

  {#each missing as source (source.source)}
    <p class="muted small missing">
      Un indicateur n'a pas pu être repris de cette source : {source.missing}. Il est absent de la
      liste plutôt qu'affiché avec une valeur périmée.
    </p>
  {/each}
</section>

<style>
  .regime {
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
  .lead {
    margin-bottom: var(--space-1);
  }
  .muted {
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .list {
    list-style: none;
    display: grid;
    gap: var(--space-4);
  }
  .list li {
    display: grid;
    gap: 2px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .list li:first-child {
    padding-top: 0;
    border-top: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .spark {
    flex: none;
  }
  /* La couleur est réservée aux variances : la courbe reste neutre. */
  .line {
    stroke: var(--fg-muted);
    stroke-width: 1.25;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .zero {
    stroke: var(--border);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .dot {
    fill: var(--fg);
  }
  .value {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .number {
    font-size: var(--fs-lg);
    font-variant-numeric: tabular-nums;
  }
  .ranks {
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .asof {
    white-space: normal;
  }
  .stale {
    font-weight: 600;
  }
  .caveat {
    border-left: 2px solid var(--border);
    padding-left: var(--space-2);
  }
  .missing {
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }
</style>
