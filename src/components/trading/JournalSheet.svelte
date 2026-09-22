<script module lang="ts">
  import type { JournalEntry } from '$lib/domain/trading/journal';

  /** Ce que la feuille rapide édite : jamais la thèse ni le plan, réservés au formulaire complet
   * de la fiche (`TradeDetail.svelte`) — « Enregistrer » les conserve tels quels. */
  export interface JournalDraftPatch {
    setup: string | null;
    mistakes: string[];
    tags: string[];
    rating: 1 | 2 | 3 | 4 | 5 | null;
    review: string;
  }

  /**
   * Brouillons en mémoire, un par trade (P122, décision n° 183) : une carte NON réactive côté
   * app — jamais dans `app.state` (donc jamais dans la sauvegarde ni synchronisée entre
   * appareils), perdue au rechargement de la page. C'est délibéré : un brouillon n'est pas une
   * donnée, c'est un filet entre deux gestes.
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- délibérément non réactive (voir ci-dessus) : un SvelteMap la mettrait sous le graphe de réactivité de Svelte.
  const drafts = new Map<string, JournalDraftPatch>();

  function patchOf(entry: JournalEntry): JournalDraftPatch {
    return {
      setup: entry.setup,
      mistakes: [...entry.mistakes],
      tags: [...entry.tags],
      rating: entry.rating,
      review: entry.review,
    };
  }
</script>

<script lang="ts">
  /**
   * Feuille d'annotation rapide : setup, erreurs, tags, note, une ligne de revue — trois gestes
   * depuis la liste (ouvrir, choisir un setup, enregistrer). La thèse et le plan restent sur la
   * fiche complète (`TradeDetail.svelte`) ; « Enregistrer » ne fait ici que FUSIONNER ce patch
   * dans l'entrée existante (`app.saveJournal`), jamais la remplacer.
   *
   * Retour Android / Échap : `history.pushState` à l'ouverture, `popstate` referme la feuille sans
   * changer de route (même URL, donc pas de `hashchange` — MDN, `Window: popstate event` et
   * `History: pushState()`, consultées le 22/09/2026 : `pushState` ne déclenche jamais lui-même
   * `popstate` ni `hashchange`). Une fermeture PAR LA FEUILLE (croix, fond, Échap natif du
   * `<dialog>`) consomme au contraire l'entrée posée via `history.back()`, pour ne pas en laisser
   * traîner une qui ne fermerait plus rien la fois suivante — sauf si l'URL a déjà changé entre
   * temps (l'utilisateur a quitté l'écran par un autre lien) : revenir en arrière romprait ALORS
   * cette navigation-là, donc on laisse l'entrée orpheline plutôt que de la corriger à l'aveugle.
   */
  import { untrack } from 'svelte';
  import { DEFAULT_MISTAKES, DEFAULT_SETUPS } from '$lib/domain/trading/journal';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';
  import TagField from './TagField.svelte';

  let { tradeId, onClose }: { tradeId: string; onClose: () => void } = $props();

  const trip = $derived(app.tripOf(tradeId));
  const title = $derived(trip ? `Annoter ${trip.trip.symbol}` : 'Annoter');

  // Composant recréé à chaque ouverture (le parent le monte sous `{#if annotatingId !== null}`),
  // donc `tradeId` ne change jamais pendant sa vie : lu une seule fois, volontairement `untrack`é
  // (même patron que `SimulateSheet.svelte`) plutôt que suivi en continu.
  const pending = untrack(() => drafts.get(tradeId));
  let draft = $state<JournalDraftPatch>(pending ?? untrack(() => patchOf(app.journalOf(tradeId))));
  const restoredDraft = pending !== undefined;

  let sheetOpen = $state(true);

  // Brouillon en mémoire : toute modification est aussitôt recopiée dans la carte partagée du
  // module, pour survivre à une fermeture par la croix sans passer par « Enregistrer ».
  $effect(() => {
    drafts.set(tradeId, $state.snapshot(draft));
  });

  // La feuille fermée (par quelque geste que ce soit) prévient le parent, qui démonte ce
  // composant : le nettoyage ci-dessous (retour Android) ne dépend donc jamais de lui.
  $effect(() => {
    if (!sheetOpen) onClose();
  });

  // Piège d'historique (Android : le retour matériel ferme la feuille au lieu de quitter l'écran).
  $effect(() => {
    if (!sheetOpen) return;
    const openedHash = window.location.hash;
    history.pushState({ ...(history.state ?? {}), journalSheet: true }, '');
    let closedByBack = false;
    const onPopState = (): void => {
      closedByBack = true;
      sheetOpen = false;
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Fermeture « depuis la feuille » (pas depuis le retour) : consomme l'entrée posée — mais
      // seulement si personne n'a déjà navigué ailleurs depuis (l'URL n'a pas bougé), sinon
      // `history.back()` annulerait CETTE navigation-là plutôt que fermer notre feuille.
      if (!closedByBack && window.location.hash === openedHash) history.back();
    };
  });

  function toggleMistake(mistake: string): void {
    draft.mistakes = draft.mistakes.includes(mistake)
      ? draft.mistakes.filter((m) => m !== mistake)
      : [...draft.mistakes, mistake];
  }

  function save(): void {
    const existing = app.journalOf(tradeId);
    app.saveJournal({
      ...existing,
      setup: draft.setup,
      mistakes: [...draft.mistakes],
      tags: [...draft.tags],
      rating: draft.rating,
      review: draft.review,
    });
    drafts.delete(tradeId);
    toasts.push('Journal enregistré.', 'success');
    sheetOpen = false;
  }
</script>

<Sheet bind:open={sheetOpen} {title} dismissible={false}>
  <div class="journal-sheet">
    {#if restoredDraft}
      <p class="muted small notice" role="status">Brouillon non enregistré, restitué.</p>
    {/if}
    <fieldset class="chips-group">
      <legend>Setup</legend>
      <div class="chips">
        {#each DEFAULT_SETUPS as setup (setup)}
          <button
            type="button"
            class="chip"
            aria-pressed={draft.setup === setup}
            onclick={() => (draft.setup = draft.setup === setup ? null : setup)}
          >
            {setup}
          </button>
        {/each}
      </div>
    </fieldset>
    <fieldset class="chips-group">
      <legend>Erreurs</legend>
      <div class="chips">
        {#each DEFAULT_MISTAKES as mistake (mistake)}
          <button
            type="button"
            class="chip"
            aria-pressed={draft.mistakes.includes(mistake)}
            onclick={() => toggleMistake(mistake)}
          >
            {mistake}
          </button>
        {/each}
      </div>
    </fieldset>
    <TagField bind:tags={draft.tags} journal={app.state.journal} id="journal-sheet-tags" />
    <fieldset class="chips-group">
      <legend>Note d'exécution</legend>
      <div class="chips" role="radiogroup" aria-label="Note d'exécution sur 5">
        {#each [1, 2, 3, 4, 5] as n (n)}
          <button
            type="button"
            class="chip"
            role="radio"
            aria-checked={draft.rating === n}
            aria-label="{n} sur 5"
            onclick={() => (draft.rating = draft.rating === n ? null : (n as 1 | 2 | 3 | 4 | 5))}
          >
            {'★'.repeat(n)}
          </button>
        {/each}
      </div>
    </fieldset>
    <label class="field">
      Revue (une ligne)
      <input type="text" bind:value={draft.review} placeholder="Ce qui a marché, ce qui non" />
    </label>
    <button class="primary" type="button" onclick={save}>Enregistrer</button>
  </div>
</Sheet>

<style>
  .journal-sheet {
    display: grid;
    gap: var(--space-3);
  }
  .notice {
    margin: 0;
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .field input {
    font: inherit;
    font-weight: 400;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  legend {
    font-weight: 600;
    font-size: var(--fs-sm);
    padding: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  .chip[aria-pressed='true'],
  .chip[aria-checked='true'] {
    background: var(--accent-trading);
    border-color: var(--accent-trading);
    color: var(--accent-fg);
    font-weight: 700;
  }
  .primary {
    justify-self: start;
  }
</style>
