<script module lang="ts">
  import type { ValueFormat } from '$lib/history/metrics';

  export interface ChartExtra {
    label: string;
    value: number;
    format: ValueFormat;
  }
  export interface ChartPoint {
    /** `YYYY-MM-DD`, ou ISO 8601 pour l'intraday. */
    day: string;
    primary: number;
    secondary: number | null;
    extras?: ChartExtra[];
    /** Valeur estimée au coût (aucune cotation) : tracée en neutre, sans gain ni perte. */
    estimated?: boolean;
  }
  export interface ChartMarker {
    day: string;
    kind: 'buy' | 'sell';
  }
  /** Ligne de niveau horizontale étiquetée (entrée moyenne, liquidation, stop, objectif…). */
  export interface ChartLevel {
    value: number;
    label: string;
    tone: 'gain' | 'loss' | 'info' | 'neutral';
  }
  export type ChartColorMode = 'trend' | 'sign' | 'vsSecondary';
</script>

<script lang="ts">
  import { D } from '$lib/domain/money';
  import { fmtDate, fmtMasked, fmtMoney, fmtPct, fmtPrice } from '$lib/format/fr';
  import type { Currency } from '$lib/fx/types';
  import { formatInstant, spansMidnight } from '$lib/history/intraday-series';
  import { numberToDecimal } from '$lib/pricing/types';
  import {
    layoutX,
    markerIndex,
    nearestIndex,
    niceTicks,
    segmentsOf,
    tickIndices,
    type Segment,
  } from './geometry';

  let {
    points,
    format = 'money',
    currency = 'EUR',
    markers = [],
    levels = [],
    step = false,
    holes = true,
    height = 220,
    zeroLine = false,
    colorMode = 'trend',
    band = false,
    labels = { primary: 'Valeur', secondary: null },
    discreet = false,
  }: {
    points: ChartPoint[];
    /** Nature de la courbe : montant (masquable), pourcentage ou prix unitaire. */
    format?: ValueFormat;
    currency?: Currency;
    markers?: ChartMarker[];
    /** Niveaux de référence horizontaux (toujours inclus dans l'échelle verticale). */
    levels?: ChartLevel[];
    /** Tracé en marches d'escalier (séries échantillonnées par une plateforme). */
    step?: boolean;
    /** false : ne jamais rompre le tracé (échantillonnage irrégulier assumé, ex. `portfolio`). */
    holes?: boolean;
    height?: number;
    /** Référence = 0 (latent) ; sinon la courbe secondaire (investi, PRU) sert de référence. */
    zeroLine?: boolean;
    colorMode?: ChartColorMode;
    /**
     * Courbe secondaire mise en avant avec étiquette en bout de courbe (PRU) ; seule la zone
     * entre les deux courbes est colorée gain/perte, les courbes restent neutres.
     */
    band?: boolean;
    labels?: { primary: string; secondary: string | null };
    /** Mode discret : montants masqués (« •••• € ») ; prix unitaires et pourcentages lisibles. */
    discreet?: boolean;
  } = $props();

  const uid = `chart-${Math.random().toString(36).slice(2, 8)}`;
  let width = $state(320);
  let hover = $state<number | null>(null);
  const PAD = { top: 28, right: 12, bottom: 26, left: 12 };

  /** Nombre SVG → chaîne décimale : jamais de flottant vers big.js ; l'arrondi reste dans fr.ts. */
  const dec = (v: number): string => numberToDecimal(v) ?? '0';
  const masked = $derived(discreet && format === 'money');
  const fmtAs = (v: number, kind: ValueFormat, sign = false): string =>
    kind === 'percent'
      ? fmtPct(D(dec(v)).div('100'), { sign })
      : kind === 'price'
        ? fmtPrice(dec(v), currency)
        : discreet
          ? fmtMasked(currency)
          : fmtMoney(dec(v), currency, { compact: true, sign });
  const fmt = (v: number): string => fmtAs(v, format);
  const isIntraday = $derived((points[0]?.day.length ?? 0) > 10);
  /** Fenêtre intraday traversant minuit (heure locale) : les heures sont préfixées du jour. */
  const withDate = $derived(
    isIntraday &&
      points.length > 1 &&
      spansMidnight(points[0]!.day, points[points.length - 1]!.day),
  );
  const label = (day: string): string =>
    day.length > 10 ? formatInstant(day, { withDate }) : fmtDate(day);

  const stats = $derived.by(() => {
    const values = points.flatMap((p) =>
      p.secondary !== null ? [p.primary, p.secondary] : [p.primary],
    );
    if (zeroLine) values.push(0);
    for (const level of levels) values.push(level.value);
    if (values.length === 0) return null;
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    return { min: min - span * 0.08, max: max + span * 0.08 };
  });
  const days = $derived(points.map((p) => p.day));
  /** Abscisses proportionnelles au temps ; les jours ou pas omis deviennent des trous. */
  const layout = $derived.by(() => {
    const raw = layoutX(days, PAD.left, width - PAD.right);
    return holes ? raw : { xs: raw.xs, holeBefore: raw.holeBefore.map(() => false) };
  });
  const x = (i: number): number => layout.xs[i] ?? PAD.left;
  const hole = (i: number): boolean => layout.holeBefore[i] ?? false;
  const y = (v: number): number =>
    stats
      ? PAD.top + ((stats.max - v) * (height - PAD.top - PAD.bottom)) / (stats.max - stats.min)
      : 0;
  /** Coordonnée SVG au dixième de pixel (géométrie, pas un montant). */
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const pt = (i: number, v: number): string => `${r1(x(i))},${r1(y(v))}`;
  /** Référence d'un point : 0 (latent) ou la courbe secondaire ; null = pas de référence (ou estimé). */
  const ref = (i: number): number | null => {
    const p = points[i];
    if (!p || p.estimated) return null;
    return zeroLine ? 0 : p.secondary;
  };
  const linePath = $derived(
    points
      .map((p, i) => {
        if (i === 0 || hole(i)) return `M${pt(i, p.primary)}`;
        // Marches : palier au niveau précédent jusqu'à l'abscisse du point, puis saut vertical.
        const riser = step ? `L${r1(x(i))},${r1(y(points[i - 1]!.primary))} ` : '';
        return `${riser}L${pt(i, p.primary)}`;
      })
      .join(' '),
  );
  const secondaryPath = $derived(
    points
      .map((p, i) =>
        p.secondary === null
          ? ''
          : `${i === 0 || hole(i) || points[i - 1]?.secondary === null ? 'M' : 'L'}${pt(i, p.secondary)}`,
      )
      .join(' '),
  );
  const hasHoles = $derived(layout.holeBefore.some(Boolean));
  /** Plages contiguës (sans trou) disposant d'une référence : gain/perte colorables. */
  const segments = $derived(segmentsOf(points.length, layout.holeBefore, (i) => ref(i) !== null));
  /** Polygone entre la courbe et sa référence sur une plage. */
  const bandPath = (s: Segment): string => {
    const fwd: string[] = [];
    const back: string[] = [];
    for (let i = s.from; i <= s.to; i++) {
      if (step && i > s.from) fwd.push(`${r1(x(i))},${r1(y(points[i - 1]!.primary))}`);
      fwd.push(pt(i, points[i]!.primary));
      back.unshift(pt(i, ref(i) ?? 0));
    }
    return `M${fwd.join(' L')} L${back.join(' L')} Z`;
  };
  /** Région au-dessus (gain) ou en dessous (perte) de la référence sur une plage. */
  const clipPath = (s: Segment, side: 'above' | 'below'): string => {
    const pts: string[] = [];
    for (let i = s.from; i <= s.to; i++) pts.push(pt(i, ref(i) ?? 0));
    const edge = side === 'above' ? 0 : height;
    return `M${pts.join(' L')} L${r1(x(s.to))},${edge} L${r1(x(s.from))},${edge} Z`;
  };
  const bottom = $derived(height - PAD.bottom);
  /** Aire sous la courbe (tendance) : seulement sans référence et sans trou. */
  const areaPath = $derived(
    segments.length === 0 && !hasHoles && points.length >= 2
      ? `${linePath} L${r1(x(points.length - 1))},${r1(bottom)} L${r1(x(0))},${r1(bottom)} Z`
      : null,
  );
  const lastSecondary = $derived.by(() => {
    for (let i = points.length - 1; i >= 0; i--)
      if (points[i]!.secondary !== null) return { i, v: points[i]!.secondary as number };
    return null;
  });
  const positive = $derived.by((): boolean => {
    const last = points[points.length - 1];
    if (!last) return true;
    const r = ref(points.length - 1);
    if (r !== null) return last.primary >= r;
    if (colorMode === 'sign') return last.primary >= 0;
    return points.length < 2 || last.primary >= points[0]!.primary;
  });
  const referenceLabel = $derived(
    zeroLine
      ? 'zéro'
      : labels.secondary
        ? labels.secondary === labels.secondary.toUpperCase()
          ? labels.secondary
          : labels.secondary.toLowerCase()
        : null,
  );
  const extremes = $derived.by(() => {
    if (points.length === 0) return null;
    let lo = 0;
    let hi = 0;
    points.forEach((p, i) => {
      if (p.primary < points[lo]!.primary) lo = i;
      if (p.primary > points[hi]!.primary) hi = i;
    });
    return { lo, hi };
  });
  const ticks = $derived(
    points.length < 2
      ? []
      : tickIndices(layout.xs, Math.min(points.length, Math.max(2, Math.floor(width / 120)))),
  );
  /** Graduations verticales « rondes » ; le zéro a sa propre ligne quand il sert de référence. */
  const yTicks = $derived(
    stats ? niceTicks(stats.min, stats.max, 3).filter((v) => !zeroLine || v !== 0) : [],
  );
  /** Marqueurs dont le jour est réellement tracé (jour exact, dans la fenêtre). */
  const resolvedMarkers = $derived(
    markers.map((m) => ({ ...m, i: markerIndex(days, m.day) })).filter((m) => m.i >= 0),
  );
  /** Description textuelle d'un point (lecteurs d'écran). */
  const describe = (i: number): string => {
    const p = points[i];
    if (!p) return '';
    const parts = [label(p.day), `${labels.primary} ${fmt(p.primary)}`];
    if (labels.secondary && p.secondary !== null)
      parts.push(`${labels.secondary} ${fmt(p.secondary)}`);
    for (const e of p.extras ?? []) parts.push(`${e.label} ${fmtAs(e.value, e.format, true)}`);
    if (p.estimated) parts.push('estimation au coût, aucune cotation');
    return parts.join(', ');
  };

  function onPointer(event: PointerEvent): void {
    if (points.length < 2) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    hover = nearestIndex(layout.xs, event.clientX - rect.left);
  }
  function onRange(event: Event): void {
    hover = Number((event.currentTarget as HTMLInputElement).value);
  }
</script>

<div class="chart" bind:clientWidth={width}>
  {#if points.length < 2 || !stats}
    <p class="empty muted">Pas encore assez de données pour tracer une courbe.</p>
  {:else}
    <svg
      viewBox="0 0 {width} {height}"
      {width}
      {height}
      role="img"
      aria-label="{labels.primary} : de {fmt(points[0]!.primary)} le {label(points[0]!.day)} à {fmt(
        points[points.length - 1]!.primary,
      )} le {label(points[points.length - 1]!.day)}"
      onpointermove={onPointer}
      onpointerdown={onPointer}
      onpointerleave={() => (hover = null)}
    >
      <defs>
        <linearGradient id="{uid}-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stop-color={positive ? 'var(--gain)' : 'var(--loss)'}
            stop-opacity="0.25"
          />
          <stop
            offset="100%"
            stop-color={positive ? 'var(--gain)' : 'var(--loss)'}
            stop-opacity="0"
          />
        </linearGradient>
        {#each segments as s (s.from)}
          <clipPath id="{uid}-above-{s.from}"><path d={clipPath(s, 'above')} /></clipPath>
          <clipPath id="{uid}-below-{s.from}"><path d={clipPath(s, 'below')} /></clipPath>
        {/each}
      </defs>
      {#each yTicks as v (v)}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} class="grid" />
        {#if !masked}<text x={PAD.left} y={y(v) - 3} class="axis">{fmt(v)}</text>{/if}
      {/each}
      {#if zeroLine}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} class="zero" />
        {#if !masked}<text x={PAD.left} y={y(0) - 3} class="axis">{fmt(0)}</text>{/if}
      {/if}
      {#each levels as level (level.label + level.value)}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y(level.value)}
          y2={y(level.value)}
          class="level {level.tone}"
        />
        <text
          x={width - PAD.right}
          y={y(level.value) - 4}
          class="level-label {level.tone}"
          text-anchor="end">{level.label} {fmt(level.value)}</text
        >
      {/each}
      {#if areaPath}
        <path d={areaPath} fill="url(#{uid}-fill)" />
      {/if}
      {#each segments as s (s.from)}
        <path d={bandPath(s)} class="band gain" clip-path="url(#{uid}-above-{s.from})" />
        <path d={bandPath(s)} class="band loss" clip-path="url(#{uid}-below-{s.from})" />
      {/each}
      {#if secondaryPath}<path d={secondaryPath} class="secondary" class:emphasis={band} />{/if}
      <path
        d={linePath}
        class="line neutral"
        class:plain={band}
        class:down={segments.length === 0 && !positive}
        class:up={segments.length === 0 && positive}
      />
      {#if !band}
        {#each segments as s (s.from)}
          <path d={linePath} class="line gain" clip-path="url(#{uid}-above-{s.from})" />
          <path d={linePath} class="line loss" clip-path="url(#{uid}-below-{s.from})" />
        {/each}
      {/if}
      {#each resolvedMarkers as m, k (k)}
        <circle cx={x(m.i)} cy={y(points[m.i]!.primary)} r="4" class="marker {m.kind}" />
      {/each}
      {#if band && lastSecondary && labels.secondary}
        <text
          x={x(lastSecondary.i)}
          y={y(lastSecondary.v) + (lastSecondary.v <= points[lastSecondary.i]!.primary ? 16 : -8)}
          class="end-label"
          text-anchor="end">{labels.secondary} {fmt(lastSecondary.v)}</text
        >
      {/if}
      {#if extremes}
        <text
          x={x(extremes.hi)}
          y={y(points[extremes.hi]!.primary) - 8}
          class="extreme"
          text-anchor={extremes.hi > points.length / 2 ? 'end' : 'start'}
          >↑ {fmt(points[extremes.hi]!.primary)}</text
        >
        <text
          x={x(extremes.lo)}
          y={y(points[extremes.lo]!.primary) + 16}
          class="extreme"
          text-anchor={extremes.lo > points.length / 2 ? 'end' : 'start'}
          >↓ {fmt(points[extremes.lo]!.primary)}</text
        >
      {/if}
      {#each ticks as i (i)}
        <text
          x={x(i)}
          y={height - 8}
          class="tick"
          text-anchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          >{label(points[i]!.day)}</text
        >
      {/each}
      {#if hover !== null && points[hover]}
        <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} class="cross" />
        <circle cx={x(hover)} cy={y(points[hover]!.primary)} r="5" class="dot" />
        {#if points[hover]!.secondary !== null}<circle
            cx={x(hover)}
            cy={y(points[hover]!.secondary as number)}
            r="4"
            class="dot secondary-dot"
          />{/if}
      {/if}
    </svg>
    <label class="explore">
      <span>Parcourir les points de la courbe</span>
      <input
        type="range"
        min="0"
        max={points.length - 1}
        step="1"
        value={hover ?? points.length - 1}
        aria-valuetext={describe(hover ?? points.length - 1)}
        oninput={onRange}
        onfocus={onRange}
        onblur={() => (hover = null)}
      />
    </label>
    <ul class="legend" aria-label="Légende">
      {#if band}
        <li>
          <span class="swatch band-swatch gain"></span>{labels.primary} au-dessus du {referenceLabel}
          (gain)
        </li>
        <li><span class="swatch band-swatch loss"></span>{labels.primary} en dessous (perte)</li>
        <li><span class="swatch line-swatch plain"></span>{labels.primary}</li>
      {:else}
        <li><span class="swatch line-swatch gain"></span>{labels.primary} en gain</li>
        <li>
          <span class="swatch line-swatch loss"></span>{labels.primary} en perte{#if referenceLabel}&nbsp;(référence
            : {referenceLabel}){/if}
        </li>
      {/if}
      {#if labels.secondary && secondaryPath}<li>
          <span class="swatch secondary-swatch" class:emphasis={band}></span>{labels.secondary}
        </li>{/if}
      {#if points.some((p) => p.estimated)}<li>
          <span class="swatch line-swatch"></span>estimé au coût (aucune cotation)
        </li>{/if}
      {#if resolvedMarkers.length > 0}<li><span class="swatch marker-swatch buy"></span>achat</li>
        <li><span class="swatch marker-swatch sell"></span>vente</li>{/if}
    </ul>
    {#if hover !== null && points[hover]}
      {@const p = points[hover]!}
      <div class="tip" style:left="{Math.min(Math.max(x(hover) - 70, 0), width - 170)}px">
        <strong>{label(p.day)}</strong><br />
        {labels.primary}
        {fmt(p.primary)}{#if labels.secondary && p.secondary !== null}<br />{labels.secondary}
          {fmt(p.secondary)}{/if}
        {#each p.extras ?? [] as e (e.label)}<br /><span class="muted"
            >{e.label} {fmtAs(e.value, e.format, true)}</span
          >{/each}
        {#if p.estimated}<br /><span class="muted">Estimation au coût (aucune cotation)</span>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    touch-action: pan-y;
    cursor: crosshair;
  }
  .grid {
    stroke: var(--border);
    stroke-dasharray: 3 4;
  }
  .level {
    fill: none;
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    opacity: 0.85;
  }
  .level.gain {
    stroke: var(--gain);
  }
  .level.loss {
    stroke: var(--loss);
  }
  .level.info {
    stroke: var(--info);
  }
  .level.neutral {
    stroke: var(--fg-muted);
  }
  .level-label {
    font-size: 11px;
    font-weight: 700;
  }
  .level-label.gain {
    fill: var(--gain);
  }
  .level-label.loss {
    fill: var(--loss);
  }
  .level-label.info {
    fill: var(--info);
  }
  .level-label.neutral {
    fill: var(--fg-muted);
  }

  .zero {
    stroke: var(--fg-faint);
  }
  .axis {
    font-size: 10px;
    fill: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .line.neutral {
    stroke: var(--fg-faint);
  }
  .line.neutral.plain {
    stroke: var(--fg);
  }
  .line.neutral.up {
    stroke: var(--gain);
  }
  .line.neutral.down {
    stroke: var(--loss);
  }
  .line.gain {
    stroke: var(--gain);
  }
  .line.loss {
    stroke: var(--loss);
  }
  .secondary {
    fill: none;
    stroke: var(--fg-muted);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
  }
  .secondary.emphasis {
    stroke: var(--accent);
    stroke-width: 2.2;
    stroke-dasharray: none;
  }
  .band.gain {
    fill: var(--gain);
    opacity: 0.2;
  }
  .band.loss {
    fill: var(--loss);
    opacity: 0.2;
  }
  .marker.buy {
    fill: var(--gain);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .marker.sell {
    fill: var(--loss);
    stroke: var(--bg);
    stroke-width: 1.5;
  }
  .extreme,
  .tick {
    font-size: 11px;
    fill: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }
  .end-label {
    font-size: 11px;
    font-weight: 700;
    fill: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .cross {
    stroke: var(--fg-faint);
    stroke-width: 1;
  }
  .dot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 2;
  }
  .secondary-dot {
    fill: var(--fg-muted);
  }
  /* Curseur clavier : invisible tant qu'il n'a pas le focus, puis affiché sous la courbe. */
  .explore {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .explore:focus-within {
    position: static;
    width: auto;
    height: auto;
    clip-path: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .explore input {
    flex: 1;
  }
  .legend {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    display: inline-block;
    width: 18px;
    height: 0;
    border-top: 2px solid var(--fg-faint);
  }
  .line-swatch.gain {
    border-top-color: var(--gain);
  }
  .line-swatch.loss {
    border-top-color: var(--loss);
  }
  .line-swatch.plain {
    border-top-color: var(--fg);
  }
  .secondary-swatch {
    border-top: 2px dashed var(--fg-muted);
  }
  .secondary-swatch.emphasis {
    border-top: 2px solid var(--accent);
  }
  .band-swatch {
    height: 10px;
    border: 0;
    opacity: 0.45;
  }
  .band-swatch.gain {
    background: var(--gain);
  }
  .band-swatch.loss {
    background: var(--loss);
  }
  .marker-swatch {
    width: 10px;
    height: 10px;
    border: 0;
    border-radius: 50%;
  }
  .marker-swatch.buy {
    background: var(--gain);
  }
  .marker-swatch.sell {
    background: var(--loss);
  }
  .tip {
    position: absolute;
    top: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    font-size: var(--fs-xs);
    pointer-events: none;
    white-space: nowrap;
    box-shadow: var(--shadow);
  }
  .empty {
    padding: var(--space-4);
    text-align: center;
    font-size: var(--fs-sm);
  }
</style>
