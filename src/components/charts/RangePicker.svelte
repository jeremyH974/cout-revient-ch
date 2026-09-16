<script lang="ts">
  /**
   * La plage d'analyse : les pastilles, **et** la plage libre qu'elles ouvrent (décision n° 157).
   *
   * Un seul composant, parce que le choix est un seul état : la pastille « Dates » n'est pas une
   * durée de plus, c'est une PORTE — elle révèle deux champs, et ne veut rien dire sans eux. Les
   * amorcer ici, une fois, évite de répéter la même logique sur chaque écran et empêche l'état
   * `custom` sans bornes, que le moteur refuse de rattraper en silence.
   *
   * **Deux champs, jamais un glissement.** Le critère 2.5.7 de WCAG 2.2 interdit une sélection qui
   * ne s'obtiendrait qu'en glissant sur une frise ; `input type="date"` est nativement utilisable au
   * clavier et annoncé par les lecteurs d'écran, sans dépendance ni code de calendrier — ce qui
   * compte double sous une CSP stricte. Les bornes se limitent l'une l'autre (`min`/`max`), si bien
   * qu'une plage inversée ne peut pas se saisir ; le moteur la lirait quand même dans l'ordre.
   */
  import { nowMs } from '$lib/clock';
  import { fmtPeriod } from '$lib/format/fr';
  import { periodWindow, todayOf, type CustomRange, type Period } from '$lib/history';
  import { app } from '../../state/app.svelte';
  import PeriodToggle from './PeriodToggle.svelte';

  let {
    available,
    /** Identifiant unique : deux sélecteurs peuvent coexister sur un même écran. */
    id,
  }: { available: readonly Period[]; id: string } = $props();

  const period = $derived<Period>(app.state.ui.period);
  const custom = $derived(app.state.ui.customRange);
  const today = $derived(todayOf(nowMs()));

  /** Le dernier mois : une plage déjà utile, qu'on n'a plus qu'à ajuster. */
  function seed(): CustomRange {
    const { from, to } = periodWindow('1m', today);
    return { from: from ?? today, to };
  }

  function choose(next: Period): void {
    if (next !== 'custom') {
      app.setUi({ period: next });
      return;
    }
    app.setUi({ period: 'custom', customRange: custom ?? seed() });
  }

  function edit(bound: 'from' | 'to', value: string): void {
    // Un champ vidé ne doit pas produire un `custom` sans bornes : on garde la valeur précédente.
    if (value === '' || custom === null) return;
    app.setUi({ customRange: { ...custom, [bound]: value } });
  }
</script>

<div class="range">
  <PeriodToggle bind:value={() => period, choose} {available} />

  {#if period === 'custom' && custom !== null}
    <fieldset class="fields">
      <legend class="sr-only">Plage de dates</legend>
      <label for="{id}-from">Du</label>
      <input
        id="{id}-from"
        type="date"
        max={custom.to}
        value={custom.from}
        onchange={(e) => edit('from', e.currentTarget.value)}
      />
      <label for="{id}-to">au</label>
      <input
        id="{id}-to"
        type="date"
        min={custom.from}
        max={today}
        value={custom.to}
        onchange={(e) => edit('to', e.currentTarget.value)}
      />
    </fieldset>
  {/if}

  <!--
    La plage retenue, annoncée sans déplacer le focus : changer une borne change tous les chiffres
    de l'écran, et un lecteur d'écran n'a aucun autre moyen de l'apprendre.
  -->
  <p class="sr-only" aria-live="polite">Plage d'analyse : {fmtPeriod(period, custom)}.</p>
</div>

<style>
  .range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .fields {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 0;
    margin: 0;
    padding: 0;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .fields input {
    min-height: 36px;
    padding: 0 8px;
    border-radius: var(--radius-sm, 8px);
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
