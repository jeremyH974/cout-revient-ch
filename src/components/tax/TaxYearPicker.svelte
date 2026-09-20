<script lang="ts">
  /**
   * Le sélecteur d'année fiscale, **le même sur les trois écrans** qui en portent un : le Rapport,
   * la Déclaration et les Impôts.
   *
   * Il en existait trois — deux libellés (« Année déclarée », « Année ») et une seule phrase
   * d'état, sur le seul écran Impôts. Le vocabulaire vit désormais dans `$lib/format/tax-year.ts`,
   * qui dit pourquoi ; ce composant ne fait que le rendre, et se charge de ce qu'une fonction pure
   * ne peut pas porter : le rattachement accessible entre le champ et la phrase qui l'explique.
   *
   * `today` est une **prop** : comme les modules purs de ce dépôt, ce composant n'a pas d'horloge —
   * c'est ce qui rend la bascule du 31 décembre vérifiable sans manipuler le temps.
   */
  import { TAX_YEAR_LABEL, taxYearWording } from '$lib/format/tax-year';

  interface Props {
    /** L'année décrite. Liée : chaque écran garde son propre état. */
    value: number;
    /** Les années proposées, de la plus récente à la plus ancienne (`declarableYears`). */
    years: readonly number[];
    /** AAAA-MM-JJ. */
    today: string;
    /**
     * Ce que l'année pilote, **quand ce n'est pas l'écran entier**. Au Rapport, elle ne gouverne
     * que les sections fiscales : le taire laisserait croire qu'elle restreint tout le rapport,
     * qui décrit lui le grand livre entier.
     */
    hint?: string | undefined;
  }
  let { value = $bindable(), years, today, hint = undefined }: Props = $props();

  const wording = $derived(taxYearWording(value, today));
  // Deux sélecteurs peuvent coexister sur une page : l'identifiant ne peut pas être une constante.
  const noteId = $props.id();
</script>

<div class="tax-year">
  <label>
    {TAX_YEAR_LABEL}
    <select bind:value aria-describedby={noteId}>
      {#each years as year (year)}
        <option value={year}>{year}</option>
      {/each}
    </select>
  </label>
  <p class="state small" id={noteId} role="status">
    <strong>{wording.state}</strong>
    {wording.detail}
    {wording.filing}
  </p>
  {#if hint}
    <p class="hint muted small">{hint}</p>
  {/if}
</div>

<style>
  .tax-year {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  label {
    display: grid;
    gap: var(--space-1);
    max-width: 12rem;
  }
  .state,
  .hint {
    margin: 0;
    max-width: 62ch;
  }
</style>
