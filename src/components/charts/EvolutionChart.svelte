<script lang="ts">
  import type { Currency } from '$lib/fx/types';
  import { fmtDate, fmtMoney } from '$lib/format/fr';

  export interface ChartPoint {
    /** `YYYY-MM-DD` (ou ISO pour l'intraday). */
    day: string;
    value: number;
    cost: number | null;
  }
  export interface ChartMarker {
    day: string;
    kind: 'buy' | 'sell';
  }

  let {
    points,
    currency = 'EUR',
    markers = [],
    height = 220,
    showCost = true,
  }: {
    points: ChartPoint[];
    currency?: Currency;
    markers?: ChartMarker[];
    height?: number;
    showCost?: boolean;
  } = $props();

  let width = $state(320);
  let hover = $state<number | null>(null);
  const PAD = { top: 28, right: 12, bottom: 26, left: 12 };

  const stats = $derived.by(() => {
    const values = points.flatMap((p) =>
      showCost && p.cost !== null ? [p.value, p.cost] : [p.value],
    );
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
  const fmt = (v: number): string => fmtMoney(v.toFixed(2), currency, { compact: true });
  const linePath = $derived(
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' '),
  );
  const areaPath = $derived(
    points.length > 1
      ? `${linePath} L${x(points.length - 1).toFixed(1)},${height - PAD.bottom} L${x(0).toFixed(1)},${height - PAD.bottom} Z`
      : '',
  );
  const costPath = $derived(
    showCost
      ? points
          .map((p, i) =>
            p.cost === null
              ? ''
              : `${i === 0 || points[i - 1]?.cost === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.cost).toFixed(1)}`,
          )
          .join(' ')
      : '',
  );
  const extremes = $derived.by(() => {
    if (points.length === 0) return null;
    let lo = 0;
    let hi = 0;
    points.forEach((p, i) => {
      if (p.value < points[lo]!.value) lo = i;
      if (p.value > points[hi]!.value) hi = i;
    });
    return { lo, hi };
  });
  const ticks = $derived.by(() => {
    const n = Math.min(points.length, Math.max(2, Math.floor(width / 120)));
    if (points.length < 2) return [];
    return Array.from({ length: n }, (_, k) => Math.round((k * (points.length - 1)) / (n - 1)));
  });
  const label = (day: string): string => (day.length > 10 ? day.slice(11, 16) : fmtDate(day));
  const markerIndex = $derived((day: string): number => points.findIndex((p) => p.day >= day));
  const trendUp = $derived(
    points.length > 1 && points[points.length - 1]!.value >= points[0]!.value,
  );

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
      aria-label="Évolution de {fmt(points[0]!.value)} le {label(points[0]!.day)} à {fmt(
        points[points.length - 1]!.value,
      )} le {label(points[points.length - 1]!.day)}"
      onpointermove={onPointer}
      onpointerdown={onPointer}
      onpointerleave={() => (hover = null)}
    >
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stop-color={trendUp ? 'var(--gain)' : 'var(--loss)'}
            stop-opacity="0.28"
          />
          <stop
            offset="100%"
            stop-color={trendUp ? 'var(--gain)' : 'var(--loss)'}
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
      <line x1={PAD.left} x2={width - PAD.right} y1={y(stats.max)} y2={y(stats.max)} class="grid" />
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={y((stats.max + stats.min) / 2)}
        y2={y((stats.max + stats.min) / 2)}
        class="grid"
      />
      <path d={areaPath} fill="url(#area-fill)" />
      {#if costPath}<path d={costPath} class="cost" />{/if}
      <path d={linePath} class="line" class:down={!trendUp} />
      {#each markers as m, k (k)}
        {@const i = markerIndex(m.day)}
        {#if i >= 0}<circle cx={x(i)} cy={y(points[i]!.value)} r="4" class="marker {m.kind}" />{/if}
      {/each}
      {#if extremes}
        <text
          x={x(extremes.hi)}
          y={y(points[extremes.hi]!.value) - 8}
          class="extreme"
          text-anchor={extremes.hi > points.length / 2 ? 'end' : 'start'}
          >↑ {fmt(points[extremes.hi]!.value)}</text
        >
        <text
          x={x(extremes.lo)}
          y={y(points[extremes.lo]!.value) + 16}
          class="extreme"
          text-anchor={extremes.lo > points.length / 2 ? 'end' : 'start'}
          >↓ {fmt(points[extremes.lo]!.value)}</text
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
        {@const p = points[hover]!}
        <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} class="cross" />
        <circle cx={x(hover)} cy={y(p.value)} r="5" class="dot" />
      {/if}
    </svg>
    {#if hover !== null}
      {@const p = points[hover]!}
      <div class="tip" style:left="{Math.min(Math.max(x(hover) - 70, 0), width - 150)}px">
        <strong>{label(p.day)}</strong><br />
        {fmt(p.value)}{#if showCost && p.cost !== null}<br /><span class="muted"
            >investi {fmt(p.cost)}</span
          >{/if}
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
  .line {
    fill: none;
    stroke: var(--gain);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .line.down {
    stroke: var(--loss);
  }
  .cost {
    fill: none;
    stroke: var(--fg-muted);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
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
  .cross {
    stroke: var(--fg-faint);
    stroke-width: 1;
  }
  .dot {
    fill: var(--accent);
    stroke: var(--bg);
    stroke-width: 2;
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
