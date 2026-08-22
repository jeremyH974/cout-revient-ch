<script module lang="ts">
  export interface ChartExtra {
    label: string;
    value: number;
    format: 'money' | 'percent';
  }
  export interface ChartPoint {
    /** `YYYY-MM-DD`, ou ISO 8601 pour l'intraday. */
    day: string;
    primary: number;
    secondary: number | null;
    extras?: ChartExtra[];
  }
  export interface ChartMarker {
    day: string;
    kind: 'buy' | 'sell';
  }
  export type ChartColorMode = 'trend' | 'sign' | 'vsSecondary';
</script>

<script lang="ts">
  import type { Currency } from '$lib/fx/types';
  import { fmtDate, fmtMoney } from '$lib/format/fr';

  let {
    points,
    format = 'money',
    currency = 'EUR',
    markers = [],
    height = 220,
    zeroLine = false,
    colorMode = 'trend',
    band = false,
    labels = { primary: 'Valeur', secondary: null },
  }: {
    points: ChartPoint[];
    format?: 'money' | 'percent';
    currency?: Currency;
    markers?: ChartMarker[];
    height?: number;
    /** Référence = 0 (latent) ; sinon la courbe secondaire (investi, PRU) sert de référence. */
    zeroLine?: boolean;
    colorMode?: ChartColorMode;
    /** Courbe secondaire mise en avant avec étiquette en bout de courbe (PRU). */
    band?: boolean;
    labels?: { primary: string; secondary: string | null };
  } = $props();

  const uid = `chart-${Math.random().toString(36).slice(2, 8)}`;
  let width = $state(320);
  let hover = $state<number | null>(null);
  const PAD = { top: 28, right: 12, bottom: 26, left: 12 };

  const fmtAs = (v: number, kind: 'money' | 'percent'): string =>
    kind === 'percent'
      ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace('.', ',')} %`
      : fmtMoney(v.toFixed(2), currency, { compact: true });
  const fmt = (v: number): string => fmtAs(v, format);
  const label = (day: string): string => (day.length > 10 ? day.slice(11, 16) : fmtDate(day));

  const stats = $derived.by(() => {
    const values = points.flatMap((p) =>
      p.secondary !== null ? [p.primary, p.secondary] : [p.primary],
    );
    if (zeroLine) values.push(0);
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
  const x = $derived((i: number): number =>
    points.length < 2
      ? PAD.left
      : PAD.left + (i * (width - PAD.left - PAD.right)) / (points.length - 1),
  );
  const y = $derived((v: number): number =>
    stats
      ? PAD.top + ((stats.max - v) * (height - PAD.top - PAD.bottom)) / (stats.max - stats.min)
      : 0,
  );
  const pt = (i: number, v: number): string => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  /** Valeur de référence d'un point : 0 (latent) ou la courbe secondaire ; null = pas de référence. */
  const ref = (i: number): number | null => (zeroLine ? 0 : (points[i]?.secondary ?? null));
  const linePath = $derived(
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(i, p.primary)}`).join(' '),
  );
  const secondaryPath = $derived(
    points
      .map((p, i) =>
        p.secondary === null
          ? ''
          : `${i === 0 || points[i - 1]?.secondary === null ? 'M' : 'L'}${pt(i, p.secondary)}`,
      )
      .join(' '),
  );
  /** Plages d'indices contigus disposant d'une référence (gain/perte colorables). */
  const segments = $derived.by((): { from: number; to: number }[] => {
    const out: { from: number; to: number }[] = [];
    let start: number | null = null;
    points.forEach((_, i) => {
      if (ref(i) !== null) start ??= i;
      else if (start !== null) {
        if (i - 1 > start) out.push({ from: start, to: i - 1 });
        start = null;
      }
    });
    if (start !== null && points.length - 1 > start)
      out.push({ from: start, to: points.length - 1 });
    return out;
  });
  /** Polygone entre la courbe et sa référence sur une plage. */
  const bandPath = (s: { from: number; to: number }): string => {
    const fwd: string[] = [];
    const back: string[] = [];
    for (let i = s.from; i <= s.to; i++) {
      fwd.push(pt(i, points[i]!.primary));
      back.unshift(pt(i, ref(i) ?? 0));
    }
    return `M${fwd.join(' L')} L${back.join(' L')} Z`;
  };
  /** Région au-dessus (gain) ou en dessous (perte) de la référence sur une plage. */
  const clipPath = (s: { from: number; to: number }, side: 'above' | 'below'): string => {
    const pts: string[] = [];
    for (let i = s.from; i <= s.to; i++) pts.push(pt(i, ref(i) ?? 0));
    const edge = side === 'above' ? 0 : height;
    return `M${pts.join(' L')} L${x(s.to).toFixed(1)},${edge} L${x(s.from).toFixed(1)},${edge} Z`;
  };
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
    zeroLine ? 'zéro' : labels.secondary ? `${labels.secondary.toLowerCase()}` : null,
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
  const ticks = $derived.by(() => {
    if (points.length < 2) return [];
    const n = Math.min(points.length, Math.max(2, Math.floor(width / 120)));
    return Array.from({ length: n }, (_, k) => Math.round((k * (points.length - 1)) / (n - 1)));
  });
  const markerIndex = (day: string): number => points.findIndex((p) => p.day >= day);

  function onPointer(event: PointerEvent): void {
    if (points.length < 2) return;
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const ratio = (event.clientX - rect.left - PAD.left) / (width - PAD.left - PAD.right);
    hover = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
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
      <line x1={PAD.left} x2={width - PAD.right} y1={y(stats.max)} y2={y(stats.max)} class="grid" />
      {#if zeroLine}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} class="zero" />
      {:else}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={y((stats.max + stats.min) / 2)}
          y2={y((stats.max + stats.min) / 2)}
          class="grid"
        />
      {/if}
      {#if segments.length === 0}
        <path
          d="{linePath} L{x(points.length - 1).toFixed(1)},{(height - PAD.bottom).toFixed(1)} L{x(
            0,
          ).toFixed(1)},{(height - PAD.bottom).toFixed(1)} Z"
          fill="url(#{uid}-fill)"
        />
      {/if}
      {#each segments as s (s.from)}
        <path d={bandPath(s)} class="band gain" clip-path="url(#{uid}-above-{s.from})" />
        <path d={bandPath(s)} class="band loss" clip-path="url(#{uid}-below-{s.from})" />
      {/each}
      {#if secondaryPath}<path d={secondaryPath} class="secondary" class:emphasis={band} />{/if}
      <path
        d={linePath}
        class="line neutral"
        class:down={segments.length === 0 && !positive}
        class:up={segments.length === 0 && positive}
      />
      {#each segments as s (s.from)}
        <path d={linePath} class="line gain" clip-path="url(#{uid}-above-{s.from})" />
        <path d={linePath} class="line loss" clip-path="url(#{uid}-below-{s.from})" />
      {/each}
      {#each markers as m, k (k)}
        {@const i = markerIndex(m.day)}
        {#if i >= 0}<circle
            cx={x(i)}
            cy={y(points[i]!.primary)}
            r="4"
            class="marker {m.kind}"
          />{/if}
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
      {#if hover !== null}
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
    <ul class="legend" aria-label="Légende">
      <li><span class="swatch line-swatch gain"></span>{labels.primary} en gain</li>
      <li>
        <span class="swatch line-swatch loss"></span>{labels.primary} en perte{#if referenceLabel}
          (référence : {referenceLabel}){/if}
      </li>
      {#if labels.secondary && secondaryPath}<li>
          <span class="swatch secondary-swatch" class:emphasis={band}></span>{labels.secondary}
        </li>{/if}
      {#if markers.length > 0}<li><span class="swatch marker-swatch buy"></span>achat</li>
        <li><span class="swatch marker-swatch sell"></span>vente</li>{/if}
    </ul>
    {#if hover !== null}
      {@const p = points[hover]!}
      <div class="tip" style:left="{Math.min(Math.max(x(hover) - 70, 0), width - 170)}px">
        <strong>{label(p.day)}</strong><br />
        {labels.primary}
        {fmt(p.primary)}{#if labels.secondary && p.secondary !== null}<br />{labels.secondary}
          {fmt(p.secondary)}{/if}
        {#each p.extras ?? [] as e (e.label)}<br /><span class="muted"
            >{e.label} {fmtAs(e.value, e.format)}</span
          >{/each}
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
  .zero {
    stroke: var(--fg-faint);
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
    border-top: 2px solid var(--fg-muted);
  }
  .line-swatch.gain {
    border-top-color: var(--gain);
  }
  .line-swatch.loss {
    border-top-color: var(--loss);
  }
  .secondary-swatch {
    border-top: 2px dashed var(--fg-muted);
  }
  .secondary-swatch.emphasis {
    border-top: 2px solid var(--accent);
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
