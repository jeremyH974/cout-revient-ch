<script lang="ts">
  /**
   * « Pourquoi ce chiffre ? » (P61). La feuille s'ouvre sur le montant lui-même, jamais sur une
   * icône « ? » semée à côté : une cible de 22 px de plus par montant ferait échouer le critère
   * `target-size` (WCAG 2.2 AA) partout où l'écran est dense.
   *
   * Tout est en euros, même quand l'application affiche des dollars : une note le dit. En mode
   * discret, les montants disparaissent mais la structure reste entière — dates, numéros de ligne,
   * type brut, jambe retenue, source du cours, trous et résidu sont des CONTRÔLES, pas des montants
   * patrimoniaux, et les masquer reviendrait à retirer la seule chose que cette feuille apporte.
   */
  import type { TraceTarget } from '$lib/domain/engine';
  import { renderTrace, traceToText } from '$lib/format/trace';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';
  import Sheet from './Sheet.svelte';
  import TraceTree from './TraceTree.svelte';

  let { open = $bindable(false), target }: { open?: boolean; target: TraceTarget } = $props();
  /** Arbre replié par défaut : la chaîne complète peut compter des dizaines de contributions. */
  let expanded = $state(false);
  $effect(() => {
    if (!open) expanded = false;
  });

  // Calculée seulement à l'ouverture : remonter tout un grand livre pour une feuille fermée
  // ferait ramer chaque écran qui en pose une.
  const trace = $derived(open ? app.trace(target) : null);
  const rendered = $derived(
    trace === null
      ? null
      : renderTrace(trace, {
          discreet: app.state.ui.discreet,
          displayCurrency: app.currency,
          accountLabels: app.accountLabels,
        }),
  );

  async function copy(): Promise<void> {
    if (!rendered) return;
    try {
      await navigator.clipboard.writeText(traceToText(rendered));
      toasts.push('Explication copiée : collez-la où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }
</script>

<Sheet bind:open title={rendered?.title ?? 'D’où vient ce chiffre ?'}>
  {#if rendered}
    <p class="head">
      <span class="formula">{rendered.formula}</span>
      {#if rendered.amount}<strong class="num">{rendered.amount}</strong>{/if}
    </p>
    <p class="residual">{rendered.residual}</p>

    <p class="tools">
      <button class="link" type="button" onclick={() => (expanded = !expanded)}
        >{expanded ? 'Tout replier' : 'Tout déplier'}</button
      >
    </p>

    <TraceTree nodes={[rendered.root]} expandAll={expanded} />

    {#if rendered.gaps.length > 0}
      <section aria-label="Ce que cette explication ne peut pas montrer">
        <h3>Ce qui ne vient pas de vos lignes</h3>
        <ul class="notes">
          {#each rendered.gaps as gap (gap)}<li>{gap}</li>{/each}
        </ul>
      </section>
    {/if}

    {#if rendered.notes.length > 0}
      <ul class="notes muted">
        {#each rendered.notes as note (note)}<li>{note}</li>{/each}
      </ul>
    {/if}

    {#if app.state.ui.discreet}
      <p class="muted small">
        Mode discret : les montants sont masqués, mais la structure reste entière — dates, numéros
        de ligne, type brut, jambe retenue, source du cours et contrôle de bouclage.
      </p>
    {/if}

    <p class="tools">
      <button class="link" type="button" onclick={() => void copy()}
        >Copier l'explication (texte)</button
      >
    </p>
  {/if}
</Sheet>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .formula {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
  .head .num {
    font-family: var(--font-mono);
  }
  .residual {
    margin: var(--space-2) 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  h3 {
    margin-top: var(--space-4);
    font-size: var(--fs-sm);
  }
  .notes {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    font-size: var(--fs-xs);
    display: grid;
    gap: var(--space-1);
  }
  .muted {
    color: var(--fg-muted);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .tools {
    margin: var(--space-2) 0;
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
    font-size: var(--fs-sm);
    min-height: 24px;
  }
</style>
