<script lang="ts">
  /**
   * Jauge de seuil : PRU, seuil et prix actuel positionnés sur un axe, avec la zone de
   * déclenchement teintée du côté où l'alerte sonnera. Purement décorative (`aria-hidden`) :
   * les chiffres exacts restent portés par le texte de l'aperçu — ici, seule la POSITION
   * compte, donc convertir en `number` pour la mise en page est acceptable (aucun montant
   * affiché n'en dérive, la règle « pas de flottant sur un montant » est respectée).
   */
  import type { Big } from '$lib/domain/money';

  let {
    pru = null,
    threshold,
    price = null,
    direction,
  }: {
    pru?: Big | null;
    threshold: Big | null;
    price?: Big | null;
    direction: 'below' | 'above';
  } = $props();

  const layout = $derived.by(() => {
    if (threshold === null) return null;
    const numbers = [pru, threshold, price]
      .filter((v): v is Big => v !== null)
      .map((v) => Number(v.toString()));
    if (numbers.length < 2 || numbers.some((v) => !Number.isFinite(v))) return null;
    let min = Math.min(...numbers);
    let max = Math.max(...numbers);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const pos = (v: Big): number => ((Number(v.toString()) - min) / (max - min)) * 100;
    const thresholdPos = pos(threshold);
    return {
      threshold: thresholdPos,
      pru: pru === null ? null : pos(pru),
      price: price === null ? null : pos(price),
      zone:
        direction === 'below'
          ? { left: 0, width: thresholdPos }
          : { left: thresholdPos, width: 100 - thresholdPos },
    };
  });
</script>

{#if layout}
  <div class="gauge" aria-hidden="true">
    <div class="track">
      <div class="zone" style="left:{layout.zone.left}%;width:{layout.zone.width}%"></div>
      {#if layout.pru !== null}<span class="tick pru" style="left:{layout.pru}%"></span>{/if}
      <span class="tick threshold" style="left:{layout.threshold}%"></span>
      {#if layout.price !== null}<span class="dot" style="left:{layout.price}%"></span>{/if}
    </div>
    <div class="legend">
      {#if layout.pru !== null}<span><i class="key pru"></i>PRU</span>{/if}
      <span><i class="key threshold"></i>Seuil</span>
      {#if layout.price !== null}<span><i class="key price"></i>Prix actuel</span>{/if}
      <span class="zone-label"><i class="key zone-key"></i>Zone de déclenchement</span>
    </div>
  </div>
{/if}

<style>
  .gauge {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  .track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .zone {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent);
    opacity: 0.18;
    border-radius: 999px;
  }
  .tick {
    position: absolute;
    top: -5px;
    bottom: -5px;
    width: 3px;
    border-radius: 2px;
    transform: translateX(-50%);
  }
  .tick.pru {
    background: var(--fg-muted);
  }
  .tick.threshold {
    background: var(--accent);
  }
  .dot {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--fg);
    border: 2px solid var(--bg-elev);
    transform: translate(-50%, -50%);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .key {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .key.pru {
    background: var(--fg-muted);
  }
  .key.threshold {
    background: var(--accent);
  }
  .key.price {
    background: var(--fg);
    border-radius: 50%;
  }
  .key.zone-key {
    background: var(--accent);
    opacity: 0.25;
  }
</style>
