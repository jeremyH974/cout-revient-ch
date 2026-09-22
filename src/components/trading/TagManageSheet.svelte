<script lang="ts">
  /**
   * Gestion des tags (P122) : usage (`tagUsage`), renommer — qui FUSIONNE si le nom cible existe
   * déjà (`renameTag`, une seule mutation de l'état via `app.renameJournalTag`) —, supprimer avec
   * confirmation. Ouverte depuis la feuille de filtres ; pas de route à elle, comme le reste des
   * feuilles de l'espace Trading.
   */
  import { tagUsage, type TagUsage } from '$lib/domain/trading/tags';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const usage = $derived(tagUsage(app.state.journal));

  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let confirmingDelete = $state<string | null>(null);

  function startRename(u: TagUsage): void {
    confirmingDelete = null;
    renaming = u.key;
    renameValue = u.label;
  }

  function commitRename(): void {
    if (renaming === null || renameValue.trim() === '') return;
    app.renameJournalTag(renaming, renameValue);
    toasts.push('Tag renommé.', 'success');
    renaming = null;
  }

  function remove(u: TagUsage): void {
    app.renameJournalTag(u.key, '');
    toasts.push('Tag supprimé.', 'success');
    confirmingDelete = null;
  }
</script>

<Sheet bind:open title="Gérer les tags">
  {#if usage.length === 0}
    <p class="muted">Aucun tag pour l'instant : ajoutez-en depuis le journal d'un trade.</p>
  {:else}
    <ul class="rows" aria-label="Tags">
      {#each usage as u (u.key)}
        <li>
          {#if renaming === u.key}
            <form
              class="rename"
              onsubmit={(e) => {
                e.preventDefault();
                commitRename();
              }}
            >
              <label class="sr-only" for="rename-{u.key}">Nouveau nom du tag {u.label}</label>
              <input id="rename-{u.key}" type="text" bind:value={renameValue} />
              <button class="secondary" type="submit">Enregistrer</button>
              <button class="secondary" type="button" onclick={() => (renaming = null)}
                >Annuler</button
              >
            </form>
          {:else if confirmingDelete === u.key}
            <div class="confirm">
              <p>
                Supprimer « {u.label} » de {u.count} trade{u.count > 1 ? 's' : ''} ? Cette action ne peut
                pas être annulée.
              </p>
              <div class="actions">
                <button class="secondary" type="button" onclick={() => remove(u)}
                  >Confirmer la suppression</button
                >
                <button class="secondary" type="button" onclick={() => (confirmingDelete = null)}
                  >Annuler</button
                >
              </div>
            </div>
          {:else}
            <span class="label"
              >{u.label}
              <span class="muted small">· {u.count} trade{u.count > 1 ? 's' : ''}</span></span
            >
            <div class="actions">
              <button class="secondary" type="button" onclick={() => startRename(u)}
                >Renommer</button
              >
              <button
                class="secondary"
                type="button"
                onclick={() => {
                  renaming = null;
                  confirmingDelete = u.key;
                }}>Supprimer</button
              >
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .rows li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    padding: var(--space-2) 0;
  }
  .rows li + li {
    border-top: 1px solid var(--border);
  }
  .label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .rename {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
  }
  .rename input {
    flex: 1;
    min-width: 8ch;
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
  }
  .confirm {
    display: grid;
    gap: var(--space-2);
    width: 100%;
  }
  .confirm p {
    margin: 0;
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
