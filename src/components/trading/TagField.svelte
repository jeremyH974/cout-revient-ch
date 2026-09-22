<script lang="ts">
  /**
   * Champ de saisie des tags du journal (P122) : puces d'entrée + combobox de suggestions, motif
   * APG « combobox with list autocomplete » (`role="combobox"`, `aria-expanded`, `aria-controls`,
   * `aria-activedescendant`, `aria-autocomplete="list"`, popup `role="listbox"` d'options
   * `role="option"` — W3C ARIA Authoring Practices Guide, motif combobox, consulté le 22/09/2026 ;
   * lien complet dans docs/proposals/2026-09-22-coherence-trading-mobile.md).
   *
   * Entrée ou virgule valident la saisie ; Retour arrière sur champ vide retire le dernier tag ;
   * Échap referme les suggestions sans fermer la feuille qui la porte (`stopPropagation` — sinon
   * le premier Échap fermerait les deux à la fois, alors que l'APG n'en attend qu'un). La
   * normalisation (espaces, casse conservée, dédoublonnage par clé) vient de `domain/trading/tags`,
   * jamais réécrite ici.
   */
  import { addTag, removeTag, tagSuggestions, type TagUsage } from '$lib/domain/trading/tags';
  import type { JournalEntry } from '$lib/domain/trading/journal';

  let {
    tags = $bindable(),
    journal,
    id,
    label = 'Tags',
  }: {
    tags: string[];
    /** Pour les suggestions par fréquence (`tagSuggestions`) — jamais mutée ici. */
    journal: Readonly<Record<string, JournalEntry>>;
    id: string;
    label?: string;
  } = $props();

  const MAX_SUGGESTIONS = 8;

  let draft = $state('');
  let activeIndex = $state(-1);
  /** Suggestions écartées par Échap : réarmé dès que l'utilisateur retape quelque chose. */
  let dismissed = $state(false);
  let inputEl = $state<HTMLInputElement>();

  const listboxId = $derived(`${id}-listbox`);
  const suggestions = $derived<TagUsage[]>(tagSuggestions(journal, draft, tags, MAX_SUGGESTIONS));
  const expanded = $derived(!dismissed && draft.trim() !== '' && suggestions.length > 0);
  const activeOptionId = $derived(
    activeIndex >= 0 && activeIndex < suggestions.length
      ? `${id}-option-${activeIndex}`
      : undefined,
  );

  function onInput(value: string): void {
    draft = value;
    dismissed = false;
    activeIndex = -1;
  }

  function commit(raw: string): void {
    tags = addTag(tags, raw);
    draft = '';
    activeIndex = -1;
    dismissed = false;
    inputEl?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      dismissed = false;
      activeIndex = (activeIndex + 1) % suggestions.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      dismissed = false;
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      return;
    }
    if (event.key === 'Enter' || event.key === ',') {
      if (draft.trim() === '') return;
      event.preventDefault();
      const chosen = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      commit(chosen ? chosen.label : draft);
      return;
    }
    if (event.key === 'Escape') {
      if (!expanded) return; // laisse Échap remonter jusqu'à la feuille, qui se ferme.
      event.stopPropagation();
      dismissed = true;
      activeIndex = -1;
      return;
    }
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      tags = removeTag(tags, tags[tags.length - 1]!);
    }
  }
</script>

<div class="tagfield">
  <span class="field-label" id="{id}-label">{label}</span>
  <div class="control">
    {#each tags as t (t)}
      <span class="pill">
        {t}
        <button
          type="button"
          class="remove"
          onclick={() => (tags = removeTag(tags, t))}
          aria-label="Retirer le tag {t}"
        >
          ×
        </button>
      </span>
    {/each}
    <input
      bind:this={inputEl}
      id="{id}-input"
      type="text"
      class="entry"
      role="combobox"
      aria-labelledby="{id}-label"
      aria-expanded={expanded}
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={activeOptionId}
      value={draft}
      oninput={(e) => onInput(e.currentTarget.value)}
      onkeydown={onKeydown}
      placeholder="Ajouter un tag…"
      autocomplete="off"
    />
  </div>
  {#if expanded}
    <ul class="listbox" role="listbox" id={listboxId} aria-labelledby="{id}-label">
      {#each suggestions as s, i (s.key)}
        <!-- Motif APG combobox : le clavier passe par le combobox (flèches déplacent
             `aria-activedescendant`, Entrée valide l'option active dans `onKeydown` ci-dessus),
             jamais par un focus posé sur l'option elle-même — lui donner un gestionnaire clavier
             propre casserait ce motif. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          role="option"
          id="{id}-option-{i}"
          aria-selected={i === activeIndex}
          class="option"
          class:active={i === activeIndex}
          onclick={() => commit(s.label)}
        >
          {s.label} <span class="muted small">({s.count})</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .tagfield {
    display: grid;
    gap: var(--space-1);
    position: relative;
  }
  .field-label {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    background: var(--bg-elev);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    padding: 0 4px 0 var(--space-2);
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  .remove {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--fg-muted);
    font-size: var(--fs-md);
    line-height: 1;
  }
  .remove:hover {
    color: var(--fg);
  }
  /* Zone cliquable agrandie par pseudo-élément, comme `Info.svelte` (WCAG 2.2 SC 2.5.8) : le
     glyphe reste petit, la cible réelle grandit au doigt sans bouger la mise en page. */
  .remove::before {
    content: '';
    position: absolute;
    inset: -3px;
  }
  @media (any-pointer: coarse) {
    .remove::before {
      inset: -10px;
    }
  }
  .entry {
    flex: 1;
    min-width: 8ch;
    min-height: 32px;
    border: 0;
    background: none;
    color: var(--fg);
    font: inherit;
    padding: 0 var(--space-1);
  }
  .entry:focus {
    outline: none;
  }
  .listbox {
    position: absolute;
    z-index: 5;
    top: 100%;
    left: 0;
    right: 0;
    margin: 2px 0 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    max-height: 40vh;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    text-align: left;
    border-radius: var(--radius-sm, 8px);
    background: none;
    color: var(--fg);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .option.active,
  .option:hover {
    background: var(--bg-sunken);
  }
</style>
