<script lang="ts">
  /**
   * La coquille commune des rapports (décision n° 178) : barre d'application, liens entre rapports,
   * actions, état vide et corps.
   *
   * La décision n° 174 avait unifié le **rendu** ; restait l'enveloppe, recopiée d'un écran à
   * l'autre — boutons, message d'absence, règle d'impression. Quatre rapports l'auraient recopiée
   * quatre fois, et une copie finit toujours par diverger de ses sœurs. Chaque écran ne garde plus
   * que ce qui lui est propre : **son modèle**.
   *
   * `stamp` est appelé avant chaque téléchargement ou impression : l'écran y remet son instant de
   * génération à l'heure, dont son modèle dépend. Sans lui, un PDF téléchargé une heure après
   * l'ouverture de la page porterait l'heure d'ouverture.
   */
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { downloadReportPdf } from '$lib/export/pdf';
  import type { ReportModel } from '$lib/export/report-model';
  import type { ReportEntry } from '$lib/reports';
  import AppBar from '../layout/AppBar.svelte';
  import { toasts } from '../../state/ui.svelte';
  import ReportBody from './ReportBody.svelte';
  import ReportLinks from './ReportLinks.svelte';

  interface Props {
    report: ReportEntry;
    model: ReportModel | null;
    stamp: () => void;
    /** Ce que l'écran dit quand il n'a rien à rapporter : pas de document vide. */
    empty: Snippet;
  }
  let { report, model, stamp, empty }: Props = $props();

  let busy = $state(false);

  async function download(): Promise<void> {
    if (busy || model === null) return;
    busy = true;
    stamp();
    await tick();
    try {
      // Le modèle a été recalculé par l'écran après `stamp` : on relit la prop, pas une copie.
      if (model === null) return;
      const fileName = await downloadReportPdf(model);
      toasts.push(`PDF téléchargé (${fileName}).`, 'success');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toasts.push(`Impossible de générer le PDF : ${reason}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function print(): Promise<void> {
    stamp();
    await tick();
    window.print();
  }
</script>

<AppBar title={report.title} back />
<ReportLinks current={report.id} />

{#if model === null}
  <section class="card empty">
    {@render empty()}
  </section>
{:else}
  <div class="actions">
    <button class="primary" type="button" onclick={() => void download()} disabled={busy}>
      {busy ? 'Génération…' : 'Télécharger le PDF'}
    </button>
    <button class="secondary" type="button" onclick={() => void print()}>
      Imprimer / Enregistrer en PDF
    </button>
    <p class="muted small">Généré dans votre navigateur : aucune donnée n'est envoyée.</p>
  </div>

  <ReportBody {model} />
{/if}

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin: 0 auto var(--space-3);
    max-width: 960px;
    padding: 0 var(--space-3);
  }
  .empty {
    max-width: 960px;
    margin: 0 auto;
    display: grid;
    gap: var(--space-2);
    justify-items: start;
  }
  .primary,
  .secondary,
  .empty :global(a.secondary) {
    border-radius: var(--radius-2);
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: transparent;
  }
  .secondary,
  .empty :global(a.secondary) {
    background: var(--bg-raised);
    color: var(--fg);
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .small {
    font-size: 0.85rem;
  }
  @media print {
    /* Le corps du rapport cache le chrome de l'application ; ici, seul le bloc d'actions. */
    .actions {
      display: none !important;
    }
  }
</style>
