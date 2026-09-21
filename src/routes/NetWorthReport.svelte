<script lang="ts">
  /**
   * Le rapport de patrimoine : le consolidé, tous espaces confondus.
   *
   * Il ne calcule rien et n'assemble rien — il lit la réconciliation que l'application tient déjà
   * (`checks.reconciliation`), la passe au constructeur de modèle, et rend ce modèle avec le MÊME
   * corps que le rapport d'investissement. C'est la raison d'être de la décision n° 174 : deux
   * périmètres, deux constructeurs, un seul rendu.
   *
   * Les périmètres sans donnée sont calculés ici et passés au modèle, parce que seul cet écran sait
   * quels espaces existent : le modèle, lui, se refuse à faire disparaître une ligne vide.
   */
  import { onMount, tick } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { buildGlobalReportModel } from '$lib/export/global-report-model';
  import { downloadReportPdf } from '$lib/export/pdf';
  import type { ReportModel } from '$lib/export/report-model';
  import { router } from '$lib/router.svelte';
  import { SPACES, spaceOfProducer } from '$lib/spaces';
  import AppBar from '../components/layout/AppBar.svelte';
  import ReportBody from '../components/report/ReportBody.svelte';
  import { app } from '../state/app.svelte';
  import { checks } from '../state/checks.svelte';
  import { history } from '../state/history.svelte';
  import { toasts } from '../state/ui.svelte';

  onMount(() => void history.ensure());

  let generatedAt = $state(nowIso());
  let busy = $state(false);

  const reconciliation = $derived(checks.reconciliation);

  /**
   * Les espaces qui produisent de la valeur et dont aucun producteur n'a de donnée.
   *
   * « Vue d'ensemble » et « Plus » n'en produisent pas : les citer comme vides serait un contresens.
   * Les trois autres, oui — et un espace absent se nomme, il ne s'omet pas.
   */
  const emptyScopes = $derived.by(() => {
    const seen = new Set((reconciliation?.lines ?? []).map((l) => spaceOfProducer(l.id)));
    return SPACES.filter((s) => s.id !== 'overview' && s.id !== 'more' && !seen.has(s.id)).map(
      (s) => s.label,
    );
  });

  const model = $derived<ReportModel | null>(
    reconciliation === null
      ? null
      : buildGlobalReportModel(reconciliation, {
          discreet: app.state.ui.discreet,
          generatedAt,
          version: __APP_VERSION__,
          emptyScopes,
        }),
  );

  async function download(): Promise<void> {
    if (busy || model === null) return;
    busy = true;
    generatedAt = nowIso();
    try {
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
    generatedAt = nowIso();
    await tick();
    window.print();
  }
</script>

<AppBar title="Rapport de patrimoine" back />

{#if model === null}
  <!--
    Pas de document vide : un rapport consolidé sans rien à consolider n'a rien à dire, et un
    tableau de zéros serait un mensonge par mise en page. On explique ce qui manque, et on renvoie
    là où la courbe se construit.
  -->
  <section class="card empty">
    <h2>Rien à consolider pour l’instant</h2>
    <p class="muted">
      Ce rapport s’appuie sur la courbe de patrimoine, qui se construit à partir de l’historique des
      cours. Elle n’est pas encore chargée — revenez quand la Vue d’ensemble affiche un patrimoine.
    </p>
    <a class="secondary" href={router.href({ name: 'overview' })}>Aller à la Vue d’ensemble</a>
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
  .secondary {
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
  .secondary {
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
