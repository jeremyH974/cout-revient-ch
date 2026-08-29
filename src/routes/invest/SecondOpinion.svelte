<script lang="ts">
  /**
   * « Second avis » (P62) : confronter les chiffres CALCULÉS par un autre outil aux nôtres.
   *
   * L'écran ne calcule rien : il lit le fichier (`import/second-opinion/*`), assemble nos chiffres
   * (`ourFiguresFrom`) et rend le résultat (`format/second-opinion.ts`). Trois règles le
   * gouvernent, et elles sont visibles à l'œil nu dans l'ordre des sections :
   *
   * 1. **Le périmètre se déclare AVANT tout affichage.** Un utilisateur qui suit plus de comptes
   *    chez l'autre outil verrait un écart massif et parfaitement légitime : tant que la case
   *    n'est pas cochée, aucun écart n'est produit (la garde est dans le moteur, pas ici).
   * 2. **Les écarts sont groupés par CAUSE**, et seul « à examiner » appelle une action. Un écart
   *    expliqué par la méthode n'est pas un problème : c'est une différence de convention.
   * 3. **Rien n'est persisté et rien n'est importé** (décision n° 3) : le fichier est lu en
   *    mémoire, comparé, puis oublié. Il n'entre jamais dans le grand livre.
   *
   * Le déclencheur « Pourquoi ce chiffre ? » porte sa raison d'être en `aria-describedby` : le
   * contenu du bouton reste le libellé, jamais l'explication (même règle que la fiche actif).
   */
  import { onMount } from 'svelte';
  import type { TraceTarget } from '$lib/domain/engine';
  import {
    compareSecondOpinion,
    ourFiguresFrom,
    type Divergence,
    type DivergenceCause,
    type SecondOpinionReport,
    type SecondOpinionSource,
  } from '$lib/domain/second-opinion';
  import { parseCsvText } from '$lib/import/csv';
  import { readSecondOpinionClaims } from '$lib/import/second-opinion/claims';
  import {
    detectSecondOpinion,
    KOINLY_PDF_REFUSAL,
    type SecondOpinionDetection,
  } from '$lib/import/second-opinion/detect';
  import {
    causeTitle,
    renderCounts,
    renderDivergence,
    renderInconclusive,
    renderRefusal,
    renderSource,
    SECOND_OPINION_DISCLAIMER,
    secondOpinionToText,
  } from '$lib/format/second-opinion';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import WhySheet from '../../components/shared/WhySheet.svelte';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import { toasts } from '../../state/ui.svelte';

  // Les lignes de l'annexe 2086 viennent de l'estimation fiscale, qui a besoin de l'historique
  // quotidien des prix. Sans lui, le moteur se tait plutôt que d'inventer une valeur globale.
  onMount(() => void history.ensure());

  let busy = $state(false);
  let dragging = $state(false);
  let fileName = $state<string | null>(null);
  let detection = $state<SecondOpinionDetection | null>(null);
  /** Réclamations lues et méta du fichier ; rien de tout cela ne quitte cette page. */
  let read = $state<ReturnType<typeof readSecondOpinionClaims> | null>(null);
  /** Arbitrage n° 6 : le périmètre se confirme explicitement, une fois, par fichier. */
  let sameScopeConfirmed = $state(false);

  const tax = $derived(history.status.loadedAt === null ? null : history.frenchTax());
  const ours = $derived(
    ourFiguresFrom({
      // Toujours en euros, comme la traçabilité et la fiscalité : comparer des fichiers ne
      // convertit rien (décisions n° 43 et n° 61).
      report: app.eurReport,
      tax,
      operationCount: app.events.length,
    }),
  );

  const source = $derived<SecondOpinionSource | null>(
    detection?.ok === true && read !== null
      ? {
          tool: detection.tool,
          declaredMethod: read.declaredMethod,
          declaredBy: 'file',
          period: read.period,
        }
      : null,
  );

  const report = $derived<SecondOpinionReport | null>(
    source !== null && read !== null
      ? compareSecondOpinion({
          source,
          label: fileName ?? 'fichier comparé',
          importId: 'second-opinion',
          claims: read.claims,
          ours,
          // Une annexe 2086 ne porte aucune opération : sans appariement, l'écart d'une ligne dont
          // la méthode est imposée par la loi reste, à juste titre, un écart à examiner.
          operations: null,
          sameScopeConfirmed,
        })
      : null,
  );

  const rendered = $derived(
    report === null || source === null
      ? []
      : report.divergences.map((d) => ({
          raw: d,
          view: renderDivergence(d, source, {
            discreet: app.state.ui.discreet,
            currency: app.currency,
          }),
        })),
  );

  /** Ordre d'affichage : ce qui appelle une action d'abord, la poussière d'arrondi en dernier. */
  const CAUSE_ORDER: readonly DivergenceCause[] = [
    'unexplained',
    'scope',
    'valuation',
    'method',
    'rounding',
  ];
  const groups = $derived(
    CAUSE_ORDER.map((cause) => ({
      cause,
      list: rendered.filter((r) => r.raw.cause === cause),
    })).filter((g) => g.list.length > 0),
  );

  const inconclusive = $derived((report?.inconclusive ?? []).map(renderInconclusive));

  const refusal = $derived(
    detection !== null && !detection.ok
      ? renderRefusal(detection.reason, detection.tool, detection.looked, detection.found)
      : null,
  );

  function reset(): void {
    detection = null;
    read = null;
    fileName = null;
    sameScopeConfirmed = false;
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    busy = true;
    reset();
    try {
      if (/\.pdf$/i.test(file.name)) {
        // Nommé plutôt que subi : un lecteur de PDF ajouterait une dépendance (décision n° 13).
        fileName = file.name;
        detection = KOINLY_PDF_REFUSAL;
        return;
      }
      const text = await file.text();
      const table = parseCsvText(text);
      const found = detectSecondOpinion(table.header);
      fileName = file.name;
      detection = found;
      read = found.ok ? readSecondOpinionClaims(table, found) : null;
    } catch (error) {
      toasts.push(`Lecture du fichier impossible : ${String(error)}`, 'error');
      reset();
    } finally {
      busy = false;
    }
  }

  let whyOpen = $state(false);
  let whyTarget = $state<TraceTarget>({ metric: 'total', scope: { kind: 'portfolio' } });
  function openWhy(divergence: Divergence): void {
    if (!divergence.gap.ourTrace) return;
    whyTarget = divergence.gap.ourTrace;
    whyOpen = true;
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secondOpinionToText(rendered.map((r) => r.view)));
      toasts.push('Comparatif copié : collez-le où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }
</script>

<AppBar title="Second avis" back={app.hasData} />

<div class="page">
  <section class="card intro">
    <h2>Comparer les chiffres d’un autre outil aux nôtres</h2>
    <p class="small">
      Déposez l’export d’un autre outil qui contient des <strong>chiffres déjà calculés</strong> — typiquement
      une annexe 2086. Ce comparatif dit d’où vient chaque différence : la méthode de calcul, le périmètre,
      la valorisation, l’arrondi, ou rien de connu. Une différence de méthode n’est pas un problème :
      deux méthodes légitimes donnent deux résultats.
    </p>
    <p class="small muted">
      Rien n’est enregistré et rien n’est importé : le fichier est lu dans ce navigateur, comparé,
      puis oublié. {SECOND_OPINION_DISCLAIMER}
    </p>
  </section>

  <label
    class="drop"
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = false;
      void handleFile(e.dataTransfer?.files[0]);
    }}
  >
    <input
      type="file"
      accept=".csv,.pdf,text/csv,application/pdf"
      disabled={busy}
      onchange={(e) => void handleFile(e.currentTarget.files?.[0])}
    />
    <span class="big">{busy ? 'Lecture en cours…' : 'Choisir le fichier à comparer'}</span>
    <span class="muted small"
      >Annexe 2086 exportée en CSV (cases 211 à 220, ou leurs libellés). Glissez-déposez ou touchez
      pour choisir.</span
    >
  </label>

  {#if refusal}
    <section class="card block refused">
      <h2>{refusal.title}</h2>
      <p>{refusal.detail}</p>
      {#if refusal.fallback}
        <p class="small muted">{refusal.fallback}</p>
        <p class="actions">
          <a class="primary" href={router.href({ name: 'import' })}>Aller à l’écran Importer</a>
        </p>
      {/if}
    </section>
  {/if}

  {#if source !== null && read !== null}
    <section class="card block">
      <h2>Fichier reconnu</h2>
      <p class="small">{renderSource(source)}</p>
      {#if read.unreadableDates.length > 0}
        <p class="small muted">
          {read.unreadableDates.length} ligne(s) sans date lisible (ligne de total, en-tête répété…) :
          elles n’ont produit aucune comparaison.
        </p>
      {/if}

      <fieldset class="scope">
        <legend>Périmètre</legend>
        <p class="small">
          Aucun écart n’est affiché tant que vous n’avez pas confirmé que les deux fichiers portent
          sur les <strong>mêmes comptes et la même période</strong>. Un périmètre différent produit
          un écart massif et parfaitement légitime.
        </p>
        <label class="choice">
          <input type="checkbox" bind:checked={sameScopeConfirmed} />
          <span>Ces deux fichiers portent sur le même périmètre.</span>
        </label>
      </fieldset>
    </section>
  {/if}

  {#if report !== null && sameScopeConfirmed}
    <section class="card block">
      <h2>Résultat</h2>
      <p class="small">{renderCounts(report)}</p>
      {#if report.counts.divergent > 0}
        <p class="actions">
          <button class="tool" type="button" onclick={() => void copy()}
            >Copier le comparatif</button
          >
        </p>
      {/if}
    </section>

    {#if report.counts.divergent === 0 && report.counts.agreed > 0}
      <section class="card block ok">
        <h2>Tous les chiffres comparés concordent</h2>
        <p class="small muted">{SECOND_OPINION_DISCLAIMER}</p>
      </section>
    {/if}

    {#each groups as group (group.cause)}
      <section class="card group {group.cause}" aria-labelledby="so-group-{group.cause}">
        <h2 id="so-group-{group.cause}">{causeTitle(group.cause)} ({group.list.length})</h2>
        <ul class="items">
          {#each group.list as card (card.view.id)}
            <li aria-labelledby="so-{card.view.id}">
              <p class="head"><strong id="so-{card.view.id}">{card.view.title}</strong></p>
              <p class="compare">{card.view.comparison}</p>
              {#if card.view.deltaLabel}<p class="small">{card.view.deltaLabel}</p>{/if}
              <p>{card.view.detail}</p>
              <p class="small muted">{card.view.classLabel}</p>
              <p class="small muted">{card.view.evidenceLabel}</p>
              {#if card.raw.gap.ourTrace}
                <p class="actions">
                  <button
                    class="link"
                    type="button"
                    aria-describedby="so-why-{card.view.id}"
                    onclick={() => openWhy(card.raw)}>Pourquoi ce chiffre ?</button
                  >
                  <span id="so-why-{card.view.id}" class="sr-only"
                    >Ouvre la chaîne de calcul de notre chiffre, jusqu’aux lignes de votre
                    portefeuille.</span
                  >
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if inconclusive.length > 0}
      <section class="card group inconclusive" aria-labelledby="so-group-inconclusive">
        <h2 id="so-group-inconclusive">Comparaisons non concluantes ({inconclusive.length})</h2>
        <ul class="items">
          {#each inconclusive as item (item.key)}
            <li aria-labelledby="so-{item.key}">
              <p class="head"><strong id="so-{item.key}">{item.title}</strong></p>
              <p>{item.detail}</p>
              <p class="small muted">{item.evidenceLabel}</p>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<WhySheet bind:open={whyOpen} target={whyTarget} />

<style>
  .page {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    max-width: 720px;
    margin: 0 auto;
  }
  section.card {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  p {
    margin: 0;
  }
  .small {
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--fg-muted);
  }
  .drop {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
    text-align: center;
    padding: var(--space-6) var(--space-4);
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    background: var(--bg-elev);
  }
  .drop.dragging {
    border-color: var(--accent);
  }
  .drop input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .big {
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--accent);
  }
  .refused {
    border-left: 4px solid var(--warn);
  }
  .ok {
    border-left: 4px solid var(--gain);
  }
  /* La couleur ne porte jamais l'information seule : le titre du groupe la porte déjà en toutes
     lettres (« Écarts à examiner », « Écarts expliqués par la méthode »…). */
  .group.unexplained {
    border-left: 4px solid var(--warn);
  }
  .group.scope,
  .group.valuation {
    border-left: 4px solid var(--info);
  }
  .group.method,
  .group.rounding,
  .group.inconclusive {
    border-left: 4px solid var(--border);
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-4);
  }
  .items > li {
    display: grid;
    gap: var(--space-1);
    padding-top: var(--space-3);
  }
  .items > li:not(:first-child) {
    border-top: 1px solid var(--border);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .compare {
    font-variant-numeric: tabular-nums;
  }
  .scope {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .scope legend {
    padding: 0 var(--space-2);
    font-weight: 700;
    font-size: var(--fs-sm);
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .tool {
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .primary {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
    text-decoration: none;
  }
  .link {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    color: var(--accent);
    text-decoration: underline;
    font-size: var(--fs-sm);
  }
</style>
