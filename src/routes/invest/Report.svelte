<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { nowIso, nowMs } from '$lib/clock';
  import { buildRequest, type AiOutcome } from '$lib/ai/contract';
  import { buildNarrativeInput, runNarrative } from '$lib/ai/narrative';
  import { ZERO, toDecimalString } from '$lib/domain/money';
  import { insightsToText } from '$lib/format/insights';
  import { msToParisDay, msToParisNaive } from '$lib/import/time';
  import { fmtDate } from '$lib/format/fr';
  import { resolveWindow, type Period } from '$lib/history';
  import { ANTHROPIC_MODEL_ID, anthropicAdapter } from '$lib/net/anthropic';
  import { accountDeclarationsToCsv, cessionsToCsv } from '$lib/export/csv-export';
  import { downloadText } from '$lib/export/download';
  import { downloadReportPdf } from '$lib/export/pdf';
  import { buildInsights } from '$lib/domain/insights';
  import { computeDeclarations, concernedDeclarations } from '$lib/domain/declarations-fr';
  import { dac8Summary, declarableYears, declarationYear } from '$lib/domain/tax-fr';
  import { riskMetrics } from '$lib/domain/risk';
  import { declarationsToText, renderDeclarations } from '$lib/format/declarations-fr';
  import {
    buildReportModel,
    section,
    type ReportModel,
    type ReportWindow,
  } from '$lib/export/report-model';
  import { router } from '$lib/router.svelte';
  import ConsentSheet from '../../components/ai/ConsentSheet.svelte';
  import NarrativeCard from '../../components/ai/NarrativeCard.svelte';
  import AllocationDonut from '../../components/charts/AllocationDonut.svelte';
  import RangePicker from '../../components/charts/RangePicker.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import TaxYearPicker from '../../components/tax/TaxYearPicker.svelte';
  import ReportBody from '../../components/report/ReportBody.svelte';
  import ReportLinks from '../../components/report/ReportLinks.svelte';
  import { aiKey } from '../../state/ai-key.svelte';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import { toasts } from '../../state/ui.svelte';

  // Le TWR et le repère se lisent dans l'historique quotidien des prix : on le charge à
  // l'ouverture du rapport (idempotent, il ne redemande que ce qui manque).
  onMount(() => void history.ensure());

  let generatedAt = $state(nowIso());
  let busy = $state(false);

  /**
   * Année décrite par la partie fiscale — **distincte de `generatedAt`**, qui date la PRODUCTION
   * du rapport (décision n° 141). Les confondre faisait décrire l'année civile en cours à l'instant
   * même où l'on remplit la déclaration de l'année précédente : au printemps 2027, le récapitulatif
   * DAC8 et les comptes à déclarer portaient sur trois mois de 2027.
   *
   * Le défaut suit la campagne déclarative (`declarationYear`) ; il est nommé à l'écran et se
   * change d'un geste.
   */
  let taxYear = $state(declarationYear(nowIso().slice(0, 10)));
  const yearChoices = $derived(declarableYears(app.events, generatedAt.slice(0, 10)));

  /**
   * La plage d'analyse (P118, décision n° 179) : la même que sur la Vue d'ensemble et les
   * statistiques de trading, lue dans le réglage partagé. « 1 jour » n'a pas de sens pour un
   * rapport : mêmes périodes que les statistiques.
   *
   * Le jour de fin se lit à Paris, comme le XIRR du rapport l'a toujours fait (`msToParisDay`) :
   * « Tout » redonne ainsi exactement les chiffres d'avant la plage.
   */
  const PERIODS: Period[] = ['1w', '1m', '3m', '1y', 'all', 'custom'];

  /**
   * Depuis l'origine, le modèle ne lit de la plage que son libellé : les autres champs ne servent
   * que sur une plage, et `from: null` le lui dit.
   */
  const ORIGIN = {
    from: null,
    endsToday: true,
    startValue: ZERO,
    endValue: ZERO,
    endCost: ZERO,
    netFlows: ZERO,
    gain: ZERO,
    realized: ZERO,
    mwr: { kind: 'none', reason: 'insufficient-flows' },
  } as const satisfies Omit<ReportWindow, 'label' | 'to'>;
  const generatedDay = $derived(msToParisDay(Date.parse(generatedAt)));
  // Pas `window` : le nom est déjà celui de l'objet global, dont `print()` sert plus bas.
  const dayWindow = $derived(
    resolveWindow(app.state.ui.period, app.state.ui.customRange, generatedDay),
  );
  /** Une période partielle se désigne par ses dates (Q&R GIPS n° 5014). */
  const windowLabel = $derived(
    dayWindow.from === null
      ? 'depuis l’origine'
      : `du ${fmtDate(dayWindow.from)} au ${fmtDate(dayWindow.to)}`,
  );

  // Tant que l'historique n'est pas chargé, la série est vide ou partielle : mieux vaut dire
  // « pas encore » que d'afficher un chiffre qui bougera sous les yeux de l'utilisateur.
  const performance = $derived(
    history.status.loadedAt === null ? undefined : history.performance('btc', dayWindow),
  );

  /** Ce que la synthèse lit sur une plage ; `null` depuis l'origine ou sans historique. */
  const reportWindow = $derived(
    history.status.loadedAt === null || dayWindow.from === null
      ? null
      : history.reportWindow(dayWindow, {
          label: windowLabel,
          endsToday: dayWindow.to >= generatedDay,
          closingValue: app.report.totals.value,
        }),
  );

  /**
   * Risque : mesuré sur l'INDICE du TWR (apports et retraits neutralisés), jamais sur la valeur —
   * sinon un virement passerait pour une perte. Nul tant que l'historique n'est pas chargé.
   */
  const risk = $derived(
    performance?.twr.ok === true
      ? riskMetrics(performance.twr.index, performance.twr.annualized)
      : null,
  );

  /** Récapitulatif DAC8 de l’année décrite : à comparer à ce que la plateforme déclarera. */
  const dac8 = $derived(dac8Summary(app.events, taxYear));

  /** Spread implicite : exige l’historique de prix, comme le risque et la fiscalité. */
  const spread = $derived(history.status.loadedAt === null ? null : history.spread());

  /** Estimation fiscale française : toujours en euros, quelle que soit la devise d'affichage. */
  const tax = $derived(history.status.loadedAt === null ? null : history.frenchTax());

  /**
   * Comptes à déclarer au formulaire 3916-bis (P66) : aucun historique de prix requis, donc
   * calculable tout de suite (contrairement à `tax`, qui attend `history.ensure()`).
   */
  const declarations = $derived(
    computeDeclarations({
      accounts: app.accounts,
      events: app.events,
      year: taxYear,
    }),
  );

  /**
   * Constats du rapport : ceux de l'accueil, ENRICHIS du repère « mêmes apports en BTC » et des
   * mesures de risque — l'écran d'accueil ne charge pas l'historique de prix, celui-ci si.
   */
  const insights = $derived(
    buildInsights({
      report: app.report,
      subscription: app.subscriptionAnalysis,
      xirr: app.portfolioXirr,
      benchmark: performance?.benchmark ?? null,
      risk,
      tax,
      taxYear,
      today: generatedAt.slice(0, 10),
    }),
  );

  const model = $derived<ReportModel>(
    buildReportModel(app.report, {
      discreet: app.state.ui.discreet,
      window: reportWindow ?? { ...ORIGIN, label: windowLabel, to: generatedDay },
      currency: app.currency,
      generatedAt,
      version: __APP_VERSION__,
      subscriptionsInPnl: app.state.engineSettings.includeSubscriptionsInPnl,
      subscription: app.subscriptionAnalysis,
      insights,
      risk,
      tax,
      declarations,
      taxYear,
      spread,
      dac8,
      performance,
    }),
  );
  /** Les comptes à déclarer existent-ils ? Deux boutons d'export en dépendent. */
  const hasDeclarations = $derived(section(model, 'declarations') !== null);

  /**
   * Les constats **déjà rendus**, lus dans la section qui les porte : le repli du récit affiche
   * ainsi exactement les phrases de l'écran, sans les recalculer (décision n° 40).
   */
  const renderedInsights = $derived.by(() => {
    const block = section(model, 'insights')?.block;
    return block?.kind === 'insights' ? block.items : [];
  });

  async function download(): Promise<void> {
    if (busy) return;
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

  /**
   * Cessions au format des colonnes du 2086 (décision n° 50) : une AIDE AU REPORT, pas une
   * déclaration — les lignes non chiffrables le disent, colonne par colonne.
   */
  function downloadCessions(): void {
    if (!tax) return;
    // Le 2086 se remplit POUR UNE ANNÉE : exporter tous les millésimes d'un coup obligeait à trier
    // le fichier à la main, et l'année ne figurait nulle part dans son nom (décision n° 141).
    downloadText(
      `cout-revient-ch-cessions-2086-${taxYear}-${model.meta.dateStamp}.csv`,
      cessionsToCsv(tax, taxYear),
      'text/csv;charset=utf-8',
    );
    toasts.push(
      `Cessions ${taxYear} exportées : une colonne par case du formulaire, à vérifier avant tout report.`,
      'success',
    );
  }

  /**
   * Comptes à déclarer au formulaire 3916-bis (P66) : une AIDE AU REPORT, pas une déclaration —
   * comme les cessions 2086 ci-dessus.
   */
  function downloadDeclarations(): void {
    downloadText(
      `cout-revient-ch-comptes-3916bis-${taxYear}-${model.meta.dateStamp}.csv`,
      accountDeclarationsToCsv(declarations),
      'text/csv;charset=utf-8',
    );
    toasts.push(`Comptes ${taxYear} exportés : à vérifier avant tout report.`, 'success');
  }

  async function copyDeclarations(): Promise<void> {
    try {
      const text = declarationsToText(renderDeclarations(concernedDeclarations(declarations)));
      await navigator.clipboard.writeText(text);
      toasts.push('Liste des comptes copiée : collez-la où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }

  async function print(): Promise<void> {
    generatedAt = nowIso();
    await tick();
    window.print();
  }

  /* --- Récit narratif (P65) ------------------------------------------------------------------
   *
   * Rien ne part sans deux gestes : l'opt-in des réglages, puis la confirmation de CET envoi. La
   * carte ne se remplit jamais toute seule à l'ouverture du rapport — un appel facturé qu'on n'a
   * pas demandé serait le contraire du consentement par usage.
   */
  let narrative = $state<AiOutcome<string> | null>(null);
  let narrativeBusy = $state(false);
  let consentOpen = $state(false);

  /** Le modèle de la version installée ; `aiModelId` reste `null` tant qu'aucun choix n'est offert. */
  const aiModelId = $derived(app.state.ui.aiModelId ?? ANTHROPIC_MODEL_ID);

  /**
   * La charge utile : la devise, les bornes de la période, les TOTAUX et les constats. Les totaux
   * y sont **par nécessité** — le modèle n'a le droit d'additionner rien du tout, donc tout chiffre
   * citable doit être une ancre (décision n° 68). Aucune ligne d'opération, aucun lot, aucune date
   * d'opération, aucune adresse : ce qui n'est pas ici ne peut pas partir.
   */
  const narrativeInput = $derived(
    buildNarrativeInput({
      devise: app.currency,
      periode: {
        du: app.report.cashFlows[0]?.at.slice(0, 10) ?? generatedAt.slice(0, 10),
        au: generatedAt.slice(0, 10),
      },
      totaux: {
        valeur: toDecimalString(app.report.totals.value),
        investi: toDecimalString(app.report.totals.costBasis),
        latent: toDecimalString(app.report.totals.unrealized),
        realise: toDecimalString(app.report.totals.realized),
        total: toDecimalString(app.report.totals.total),
      },
      insights,
    }),
  );
  const narrativeRequest = $derived(buildRequest('narrative', narrativeInput));

  /**
   * Le repli, tel qu'il sera affiché : c'est `insightsToText` — la fonction que le presse-papier
   * utilise déjà — dont on retire seulement la puce, l'élément de liste la portant lui-même.
   */
  const fallbackLines = $derived(
    insightsToText(renderedInsights)
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/^- /, '')),
  );

  function askNarrative(): void {
    if (!aiKey.present) {
      toasts.push(
        'Collez votre clé d’API dans les réglages : elle reste dans cet onglet.',
        'error',
      );
      return;
    }
    // Le consentement est lié à la CHARGE UTILE : un ré-import, un prix rafraîchi ou un changement
    // de devise change le JSON, donc l'empreinte, donc la question est reposée.
    if (aiKey.hasConsent(narrativeRequest, aiModelId)) void writeNarrative();
    else consentOpen = true;
  }

  async function writeNarrative(): Promise<void> {
    const key = aiKey.value;
    if (key === null || narrativeBusy) return;
    narrativeBusy = true;
    try {
      narrative = await runNarrative(
        anthropicAdapter(key, { modelId: aiModelId }),
        narrativeInput,
        msToParisNaive(nowMs()),
      );
    } finally {
      narrativeBusy = false;
    }
  }

  async function copyNarrative(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toasts.push('Récit copié, étiquette comprise.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }
</script>

<AppBar title="Rapport de portefeuille" back />
<ReportLinks current="invest" />

<!-- L'année DÉCRITE, jamais celle de la génération (décision n° 141). Le 2086, le 3916-bis et le
     récapitulatif DAC8 ne portent que sur une année, et au printemps on remplit celle d'avant.
     Elle est sortie de la barre d'actions : rangée entre les boutons, elle passait pour un réglage
     du rapport entier, alors que le rapport décrit le grand livre depuis le début. -->
<div class="scope">
  <div class="range">
    <RangePicker id="report" available={PERIODS} />
    <p class="muted small">
      La plage gouverne la synthèse, le résultat, les rendements et le risque. Les sections fiscales
      suivent l’année fiscale ci-dessous.
    </p>
  </div>
  <TaxYearPicker
    bind:value={taxYear}
    years={yearChoices}
    today={generatedAt.slice(0, 10)}
    hint="Ne s’applique qu’aux sections fiscales et à leurs exports : cessions 2086, comptes 3916-bis, récapitulatif DAC8. Le reste du rapport couvre l’intégralité de vos opérations."
  />
</div>

<div class="actions">
  <button class="primary" type="button" onclick={() => void download()} disabled={busy}>
    {busy ? 'Génération…' : 'Télécharger le PDF'}
  </button>
  {#if tax && tax.cessions.length > 0}
    <button class="secondary" type="button" onclick={downloadCessions}>
      Cessions au format 2086 (CSV)
    </button>
    <!-- Second avis (P62) : l'annexe 2086 est le seul terrain où la méthode est imposée par la
         loi des deux côtés — c'est donc ici, à côté de nos propres cessions, que la comparaison
         avec l'annexe d'un autre outil a un sens. -->
    <a class="secondary" href={router.href({ name: 'secondOpinion' })}>
      Comparer à une annexe 2086 d’un autre outil
    </a>
  {/if}
  {#if hasDeclarations}
    <button class="secondary" type="button" onclick={downloadDeclarations}>
      Comptes à déclarer (3916-bis, CSV)
    </button>
    <button class="secondary" type="button" onclick={() => void copyDeclarations()}>
      Copier la liste
    </button>
  {/if}
  <button class="secondary" type="button" onclick={() => void print()}>
    Imprimer / Enregistrer en PDF
  </button>
  <p class="muted small">Généré dans votre navigateur : aucune donnée n'est envoyée.</p>
</div>

<ReportBody {model}>
  {#snippet afterCover()}
    {#if app.state.ui.aiEnabled}
      <NarrativeCard
        outcome={narrative}
        {fallbackLines}
        busy={narrativeBusy}
        ready={aiKey.present}
        onrequest={askNarrative}
        oncopy={(text) => void copyNarrative(text)}
      />
    {/if}
  {/snippet}
  {#snippet allocationChart()}
    <AllocationDonut entries={app.report.allocation} />
  {/snippet}
</ReportBody>

<ConsentSheet
  bind:open={consentOpen}
  request={narrativeRequest}
  modelId={aiModelId}
  purpose="Récit de votre rapport, rédigé à partir des constats ci-dessous."
  discreet={app.state.ui.discreet}
  onsend={() => {
    aiKey.grantConsent(narrativeRequest, aiModelId);
    void writeNarrative();
  }}
  oncancel={() => {
    // Un consentement refusé n'est pas une panne : c'est le même état que « pas de modèle », et la
    // carte affiche le repli déterministe plutôt qu'un message d'échec.
    narrative = { status: 'refused', reason: 'no-model', fallback: 'deterministic' };
  }}
/>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-3);
  }
  .scope {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-3) var(--space-3) 0;
  }
  .small {
    font-size: var(--fs-xs);
  }
  @media print {
    /* Le corps du rapport cache le chrome de l'application ; ici, seuls les deux blocs qui
       appartiennent encore à cet écran. */
    .scope,
    .actions {
      display: none !important;
    }
  }
</style>
