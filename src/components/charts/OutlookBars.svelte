<script module lang="ts">
  import type { Big as BigType } from '$lib/domain/money';

  export interface OutlookBar {
    month: string;
    principal: BigType;
    interest: BigType;
    total: BigType;
  }
</script>

<script lang="ts">
  /**
   * Échéancier à venir, en colonnes empilées : capital en bas, intérêts au-dessus.
   *
   * **Pas de SVG.** Douze colonnes à deux segments se dessinent en CSS, avec une hauteur relative
   * au plus haut mois. C'est moins de code qu'une géométrie SVG, et surtout ça reste responsive
   * sans recalcul : les colonnes se partagent la largeur, les libellés tournent quand ils ne
   * tiennent plus.
   *
   * **Accessibilité.** Le graphique est décoratif (`aria-hidden`) et un **tableau équivalent**,
   * masqué visuellement mais bien présent dans l'arbre d'accessibilité, porte les mêmes chiffres —
   * c'est le patron que recommandent les guides d'accessibilité de la visualisation, et le seul
   * qui rende un graphique utilisable au lecteur d'écran. La couleur ne distingue rien à elle
   * seule (WCAG 1.4.1) : la légende nomme les deux segments, et le tableau les sépare en colonnes.
   *
   * **Aucun `number` ne porte un montant** : les seuls nombres calculés ici sont des hauteurs en
   * pourcentage, dérivées d'un rapport `Big`.
   */
  import { ZERO, type Big } from '$lib/domain/money';
  import { fmtMonth } from '$lib/format/fr';
  import Money from '../shared/Money.svelte';

  interface Props {
    bars: readonly OutlookBar[];
    /** Plus haut total de la fenêtre : l'échelle. `0` rend des colonnes vides, pas une division. */
    peak: Big;
    principalLabel?: string;
    interestLabel?: string;
  }

  let { bars, peak, principalLabel = 'Capital', interestLabel = 'Intérêts' }: Props = $props();

  /** Hauteur en pourcentage de la colonne la plus haute ; jamais une division par zéro. */
  const pct = (value: Big): number =>
    peak.gt(ZERO) ? Math.round(Number(value.div(peak).toString()) * 1000) / 10 : 0;

  const columns = $derived(
    bars.map((bar) => ({
      ...bar,
      principalPct: pct(bar.principal),
      interestPct: pct(bar.interest),
      empty: !bar.total.gt(ZERO),
    })),
  );
</script>

<figure class="outlook">
  <ul class="key">
    <li><span class="swatch principal" aria-hidden="true"></span>{principalLabel}</li>
    <li><span class="swatch interest" aria-hidden="true"></span>{interestLabel}</li>
  </ul>

  <div class="plot" aria-hidden="true">
    {#each columns as column (column.month)}
      <div class="column" class:empty={column.empty}>
        <div class="stack">
          <div class="seg interest" style="height: {column.interestPct}%"></div>
          <div class="seg principal" style="height: {column.principalPct}%"></div>
        </div>
        <span class="tick">{fmtMonth(column.month, { short: true })}</span>
      </div>
    {/each}
  </div>

  <table class="sr-only">
    <caption>Échéances annoncées par vos contrats, mois par mois</caption>
    <thead>
      <tr>
        <th scope="col">Mois</th>
        <th scope="col">{principalLabel}</th>
        <th scope="col">{interestLabel}</th>
        <th scope="col">Total</th>
      </tr>
    </thead>
    <tbody>
      {#each bars as bar (bar.month)}
        <tr>
          <th scope="row">{fmtMonth(bar.month)}</th>
          <td><Money value={bar.principal} /></td>
          <td><Money value={bar.interest} /></td>
          <td><Money value={bar.total} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</figure>

<style>
  .outlook {
    margin: 0;
  }
  .key {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .key li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex: none;
  }
  .principal {
    background: var(--accent);
  }
  .interest {
    background: var(--gain);
  }
  .plot {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
    /* Une hauteur fixe : le graphique ne doit pas changer de taille quand les données changent. */
    height: 160px;
    padding-bottom: 1.6rem;
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .column {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .stack {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
    /* Un mois vide garde un filet : la colonne existe, elle vaut zéro. */
    border-bottom: 2px solid transparent;
  }
  .column.empty .stack {
    border-bottom-color: var(--border);
  }
  .seg {
    border-radius: 2px 2px 0 0;
    min-height: 0;
  }
  .seg.principal {
    border-radius: 0;
  }
  .tick {
    position: absolute;
    bottom: 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    white-space: nowrap;
    transform: translateY(0.2rem);
  }
  .column .tick {
    position: static;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-top: var(--space-1);
  }
  @media (max-width: 40rem) {
    .tick {
      font-size: 10px;
    }
  }
  @media print {
    .outlook {
      break-inside: avoid;
    }
  }
</style>
