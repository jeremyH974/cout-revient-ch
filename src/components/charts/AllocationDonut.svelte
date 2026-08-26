<script lang="ts">
  /**
   * Répartition de la valeur en anneau (décision n° 41). SVG maison, aucune dépendance.
   *
   * Les parts arrivent DÉJÀ calculées par le moteur (`report.allocation`) : ce composant ne fait
   * que de la mise en page, donc les seuls `number` qu'il manipule sont des longueurs d'arc — pas
   * des montants (la règle du projet vaut toujours : aucun `number` ne porte une valeur).
   *
   * Accessibilité : l'anneau est décoratif (`aria-hidden`), la légende porte les chiffres, et le
   * tableau « Répartition » qui suit reste la source lisible par un lecteur d'écran.
   */
  import type { AssetCode } from '$lib/domain/types';
  import type { Big } from '$lib/domain/money';
  import { fmtPct } from '$lib/format/fr';

  interface Slice {
    asset: AssetCode;
    share: Big;
  }
  interface Props {
    /** Parts du moteur, dans n'importe quel ordre : le composant trie et regroupe la queue. */
    entries: readonly Slice[];
    /** Nombre de parts nommées avant le regroupement en « autres ». */
    max?: number;
  }
  let { entries, max = 6 }: Props = $props();

  /** Palette : assez de teintes distinctes pour `max` parts, contrastées en clair comme en sombre. */
  const COLORS = [
    '#5b8def',
    '#f0a24b',
    '#4ec9a5',
    '#c084fc',
    '#f472b6',
    '#facc15',
    '#94a3b8',
  ] as const;

  const RADIUS = 60;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const slices = $derived.by(() => {
    const sorted = [...entries].filter((e) => e.share.gt('0')).sort((a, b) => b.share.cmp(a.share));
    if (sorted.length <= max) return sorted.map((e) => ({ ...e, label: e.asset.toUpperCase() }));
    const head = sorted.slice(0, max - 1).map((e) => ({ ...e, label: e.asset.toUpperCase() }));
    const rest = sorted.slice(max - 1);
    const share = rest.reduce((acc, e) => acc.plus(e.share), rest[0]!.share.times('0'));
    return [...head, { asset: 'autres' as AssetCode, share, label: `${rest.length} autres` }];
  });

  /** Arcs cumulés : chaque part est un trait pointillé décalé de la somme des précédentes. */
  const arcs = $derived.by(() => {
    let offset = 0;
    return slices.map((slice, i) => {
      const length = Number(slice.share.toString()) * CIRCUMFERENCE;
      const arc = { length, offset, color: COLORS[i % COLORS.length]! };
      offset += length;
      return arc;
    });
  });
</script>

{#if slices.length > 0}
  <div class="donut">
    <svg viewBox="0 0 160 160" aria-hidden="true">
      <g transform="translate(80 80) rotate(-90)">
        {#each arcs as arc, i (i)}
          <circle
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            stroke-width="20"
            stroke-dasharray="{arc.length} {CIRCUMFERENCE - arc.length}"
            stroke-dashoffset={-arc.offset}
          />
        {/each}
      </g>
    </svg>
    <ul class="legend">
      {#each slices as slice, i (slice.asset)}
        <li>
          <span class="swatch" style="background: {COLORS[i % COLORS.length]}" aria-hidden="true"
          ></span>
          <span class="name">{slice.label}</span>
          <span class="share num">{fmtPct(slice.share, { sign: false })}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .donut {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }
  svg {
    width: 160px;
    height: 160px;
    flex: none;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-1) var(--space-3);
    flex: 1;
    min-width: 12rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .share {
    color: var(--fg-muted);
  }
  @media print {
    .donut {
      break-inside: avoid;
    }
  }
</style>
