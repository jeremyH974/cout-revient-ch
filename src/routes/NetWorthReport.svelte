<script lang="ts">
  /**
   * Le rapport de patrimoine : le consolidé, tous espaces confondus.
   *
   * Il ne calcule rien et n'assemble rien — il lit la réconciliation que l'application tient déjà
   * (`checks.reconciliation`), la passe au constructeur de modèle, et rend ce modèle dans la
   * coquille commune des rapports (décision n° 178), avec le MÊME corps que les trois autres.
   *
   * Les périmètres sans donnée sont calculés ici et passés au modèle, parce que seul cet écran sait
   * quels espaces existent : le modèle, lui, se refuse à faire disparaître une ligne vide.
   */
  import { onMount } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { buildGlobalReportModel } from '$lib/export/global-report-model';
  import type { ReportModel } from '$lib/export/report-model';
  import { reportAt } from '$lib/reports';
  import { router } from '$lib/router.svelte';
  import { SPACES } from '$lib/spaces';
  import ReportShell from '../components/report/ReportShell.svelte';
  import { app } from '../state/app.svelte';
  import { checks } from '../state/checks.svelte';
  import { history } from '../state/history.svelte';

  onMount(() => void history.ensure());

  const report = reportAt('netWorthReport')!;
  let generatedAt = $state(nowIso());

  const reconciliation = $derived(checks.reconciliation);

  /**
   * Les espaces qui produisent de la valeur et dont aucun producteur n'a de donnée.
   *
   * « Vue d'ensemble » et « Plus » n'en produisent pas : les citer comme vides serait un contresens.
   * Les trois autres, oui — et un espace absent se nomme, il ne s'omet pas.
   */
  const emptyScopes = $derived.by(() => {
    const seen = new Set<string>((reconciliation?.lines ?? []).map((l) => l.space));
    return SPACES.filter((s) => s.id !== 'overview' && s.id !== 'more' && !seen.has(s.id)).map(
      (s) => s.label,
    );
  });

  const model = $derived<ReportModel | null>(
    reconciliation === null
      ? null
      : buildGlobalReportModel(reconciliation, {
          discreet: app.state.ui.discreet,
          // La courbe de patrimoine est dans la devise d'affichage (`pricesFor` convertit en
          // amont) : sans cette ligne, le PDF l'étiquetait « EUR » quelle que soit la devise.
          currency: app.currency,
          generatedAt,
          version: __APP_VERSION__,
          emptyScopes,
        }),
  );
</script>

<ReportShell {report} {model} stamp={() => (generatedAt = nowIso())}>
  {#snippet empty()}
    <!--
      Pas de document vide : un rapport consolidé sans rien à consolider n'a rien à dire, et un
      tableau de zéros serait un mensonge par mise en page. On explique ce qui manque, et on renvoie
      là où la courbe se construit.
    -->
    <h2>Rien à consolider pour l’instant</h2>
    <p class="muted">
      Ce rapport s’appuie sur la courbe de patrimoine, qui se construit à partir de l’historique des
      cours. Elle n’est pas encore chargée — revenez quand la Vue d’ensemble affiche un patrimoine.
    </p>
    <a class="secondary" href={router.href({ name: 'overview' })}>Aller à la Vue d’ensemble</a>
  {/snippet}
</ReportShell>
