<script lang="ts">
  import { renderWatchEntries, watchTopicLabel } from '$lib/format/watch';
  import { relevantTo, WATCH_ENTRIES, type WatchTopic } from '$lib/watch/entries';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';

  /**
   * Veille réglementaire française sur la fiscalité des crypto-actifs (P67).
   *
   * Comme le calendrier macro (`Market.svelte`), rien ici n'est demandé au réseau : la table
   * (`$lib/watch/entries.ts`) est compilée dans le bundle, tenue entièrement à la main, et relue
   * selon sa propre barrière de fraîcheur (voir l'en-tête du module). Cet écran affiche des FAITS
   * datés, jamais un conseil — la formulation du bandeau ci-dessous est volontairement stable.
   */

  const TOPICS: readonly WatchTopic[] = [
    'cession',
    'detention',
    'revenus',
    'declaratif',
    'nft',
    'ia',
  ];

  let topic = $state<WatchTopic | 'all'>('all');

  const filtered = $derived(topic === 'all' ? WATCH_ENTRIES : relevantTo(WATCH_ENTRIES, topic));
  const rendered = $derived(renderWatchEntries(filtered));
</script>

<AppBar title="Veille réglementaire" back={app.hasData} />

<div class="page">
  <section class="card intro">
    <h2>Fiscalité française des crypto-actifs</h2>
    <p class="muted">
      Ce qui suit décrit l'état du droit et de la doctrine fiscale française applicables aux
      crypto-actifs — et les obligations qui pèsent sur ce que l'app affiche —, à la date indiquée
      pour chaque ligne. Ce n'est ni une déclaration, ni un conseil fiscal, ni une prévision : l'app
      ne dit pas ce qui sera voté, seulement ce qui l'a été et ce qui est proposé. Faites vérifier
      votre situation par un professionnel avant toute décision.
    </p>
  </section>

  <div class="controls">
    <label class="filter">
      <span>Thème</span>
      <select bind:value={topic}>
        <option value="all">Tous</option>
        {#each TOPICS as t (t)}
          <option value={t}>{watchTopicLabel(t)}</option>
        {/each}
      </select>
    </label>
  </div>

  <section aria-labelledby="entries-heading">
    <h2 id="entries-heading">Ce que dit le droit, ligne par ligne</h2>
    {#if rendered.length === 0}
      <p class="muted empty">Aucune entrée pour ce thème.</p>
    {:else}
      <ul class="entries">
        {#each rendered as entry (entry.id)}
          <li>
            <article class="card entry">
              <div class="head">
                <h3>{entry.title}</h3>
                <span class="status">{entry.statusLabel}</span>
              </div>
              <p class="effect">{entry.effect}</p>
              <p class="meta muted">
                Statut au {entry.statusDate}
                {#if entry.deadline}
                  · Échéance annoncée : {entry.deadline}
                {/if}
                · Relu le {entry.reviewedOn}
              </p>
              <p class="source muted">
                Source :
                {#if entry.sourceUrl}
                  <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer"
                    >{entry.sourceLabel}</a
                  >
                {:else}
                  {entry.sourceLabel} (aucune adresse officielle confirmée)
                {/if}
              </p>
              {#if entry.secondaryOnly}
                <p class="note">{entry.certaintyLabel}</p>
              {/if}
            </article>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card notes" aria-labelledby="notes-heading">
    <h2 id="notes-heading">Comment cette page est tenue</h2>
    <ul>
      <li>
        Table tenue entièrement à la main : aucune requête n'est faite à l'exécution, cette page
        fonctionne hors ligne.
      </li>
      <li>
        Une barrière automatique, relancée chaque mois, empêche de publier une ligne dont la
        relecture est trop ancienne (3 mois pour un statut mouvant, 6 pour un statut stable) ou dont
        une échéance annoncée est dépassée sans nouvelle relecture.
      </li>
      <li>
        Une source marquée « non officielle » reprend une position de cabinets ou de praticiens,
        jamais un texte opposable.
      </li>
    </ul>
  </section>
</div>

<style>
  .page {
    padding: var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    font-size: var(--fs-md);
    margin-bottom: var(--space-2);
  }
  h3 {
    font-size: var(--fs-sm);
    margin: 0;
  }
  .intro,
  .notes,
  .entry {
    padding: var(--space-4);
  }
  .intro h2 {
    margin-bottom: var(--space-2);
  }
  .muted {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .filter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    min-height: var(--tap);
    max-width: 100%;
  }
  .filter select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-2);
    max-width: 100%;
    min-width: 0;
  }
  section {
    display: grid;
    gap: var(--space-3);
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .entry {
    display: grid;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .status {
    font-size: var(--fs-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    white-space: nowrap;
  }
  .effect {
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .meta,
  .source {
    font-size: var(--fs-xs);
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    font-style: italic;
  }
  .empty {
    padding: var(--space-4);
  }
  .notes ul {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-4);
  }
  .notes li {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    line-height: 1.5;
  }
</style>
