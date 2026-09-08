<script module lang="ts">
  import type { Big as BigType } from '$lib/domain/money';

  export interface RingSlice {
    key: string;
    label: string;
    /** Montant dans la devise d'affichage ; `null` = non mesurable, la part est alors absente. */
    value: BigType | null;
    /** Teinte de la pastille et de l'arc. La légende reste lisible sans elle. */
    color: string;
    /** Précision de ce que la part représente, en petit sous le libellé. */
    hint?: string;
  }
</script>

<script lang="ts">
  /**
   * Anneau à parts nommées, avec un total au centre. SVG maison, aucune dépendance.
   *
   * **Pourquoi un second composant d'anneau.** `AllocationDonut` répond à une autre question : il
   * prend des *parts déjà calculées* par actif, regroupe la queue en « autres » et n'affiche que
   * des pourcentages. Ici les parts sont peu nombreuses, connues d'avance, et ce sont les
   * **montants** qui doivent se lire — un total au centre, ses composantes autour. Fondre les deux
   * donnerait un composant à deux modes, qui n'en ferait bien aucun.
   *
   * **Accessibilité** (WAI-ARIA APG, et le patron que les guides d'accessibilité de la
   * visualisation recommandent) : l'anneau est **décoratif** (`aria-hidden`), et toute
   * l'information vit dans la légende — nom, montant, part. Un lecteur d'écran lit donc une liste,
   * jamais un graphique muet. La couleur ne porte aucune information seule (WCAG 1.4.1) : chaque
   * part est nommée et chiffrée à côté de sa pastille.
   *
   * **Aucun `number` ne porte un montant** (règle du projet) : les seuls nombres manipulés ici
   * sont des longueurs d'arc en pixels, dérivées d'un rapport `Big`.
   */
  import { ZERO, type Big } from '$lib/domain/money';
  import { fmtPct } from '$lib/format/fr';
  import Money from '../shared/Money.svelte';

  interface Props {
    slices: readonly RingSlice[];
    /** Libellé du centre, en capitales discrètes. */
    centreLabel: string;
    /** Total au centre. Par défaut : la somme des parts mesurables. */
    centre?: Big | null;
  }

  let { slices, centreLabel, centre }: Props = $props();

  const measured = $derived(
    slices.filter((s): s is RingSlice & { value: Big } => s.value !== null && s.value.gte(ZERO)),
  );
  const total = $derived.by((): Big | null => {
    if (centre !== undefined) return centre;
    return measured.length === 0 ? null : measured.reduce((t, s) => t.plus(s.value), ZERO);
  });
  /** Somme des parts : le dénominateur des arcs, qui n'est pas forcément le total affiché. */
  const span = $derived(measured.reduce((t, s) => t.plus(s.value), ZERO));

  const RADIUS = 54;
  // Un anneau plus fin laisse au centre de quoi écrire un libellé SANS le chevaucher.
  const WIDTH = 16;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const shareOf = (value: Big): Big | null => (span.gt(ZERO) ? value.div(span) : null);

  /** Arcs cumulés : chaque part est un pointillé unique, décalé de la somme des précédentes. */
  const arcs = $derived.by(() => {
    let offset = 0;
    return measured.map((slice) => {
      const share = shareOf(slice.value);
      const length = share === null ? 0 : Number(share.toString()) * CIRCUMFERENCE;
      const arc = { key: slice.key, length, offset, color: slice.color };
      offset += length;
      return arc;
    });
  });
</script>

<div class="ring">
  <div class="dial">
    <svg viewBox="0 0 128 128" aria-hidden="true">
      <g transform="translate(64 64) rotate(-90)">
        <circle r={RADIUS} fill="none" stroke="var(--bg-sunken)" stroke-width={WIDTH} />
        {#each arcs as arc (arc.key)}
          <circle
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            stroke-width={WIDTH}
            stroke-dasharray="{arc.length} {CIRCUMFERENCE - arc.length}"
            stroke-dashoffset={-arc.offset}
          />
        {/each}
      </g>
    </svg>
    <!-- Le centre n'est PAS aria-hidden : c'est le total, et il doit se lire. -->
    <div class="centre">
      <span class="centre-label">{centreLabel}</span>
      <strong class="centre-value"><Money value={total} /></strong>
    </div>
  </div>

  <ul class="legend">
    {#each slices as slice (slice.key)}
      <li>
        <span class="swatch" style="background: {slice.color}" aria-hidden="true"></span>
        <span class="name">
          {slice.label}
          {#if slice.hint}<span class="hint">{slice.hint}</span>{/if}
        </span>
        <span class="amount"><Money value={slice.value} /></span>
        <span class="share">
          {#if slice.value === null}
            —
          {:else}
            {@const share = shareOf(slice.value)}
            {share === null ? '—' : fmtPct(share, { sign: false })}
          {/if}
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .ring {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
  }
  .dial {
    position: relative;
    width: 140px;
    height: 140px;
    flex: none;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .centre {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-align: center;
    padding: 0 var(--space-2);
  }
  .centre-label {
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .centre-value {
    font-size: var(--fs-sm);
    line-height: 1.15;
  }
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    flex: 1;
    min-width: 14rem;
  }
  li {
    display: grid;
    grid-template-columns: 10px 1fr auto auto;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    align-self: center;
  }
  .name {
    min-width: 0;
  }
  .hint {
    display: block;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .amount {
    font-variant-numeric: tabular-nums;
  }
  .share {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    min-width: 3.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  @media print {
    .ring {
      break-inside: avoid;
    }
  }
</style>
