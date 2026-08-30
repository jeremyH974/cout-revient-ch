<script lang="ts">
  /**
   * L'écran de confirmation d'un appariement de colonnes (P64).
   *
   * ## Rien n'est importé sans confirmation, ligne à ligne
   *
   * Chaque champ cible est une ligne, avec la colonne proposée, sa **confiance** et sa
   * **provenance**. L'utilisateur peut changer n'importe laquelle avant d'importer — y compris
   * celles que l'application donne pour sûres. Un appariement automatique, si bon soit-il, décide
   * du sens de toutes les opérations d'un fichier : il ne s'applique pas sans qu'on l'ait vu.
   *
   * ## La distinction n'est jamais portée par la seule couleur
   *
   * Confiance et provenance sont dites par une **pastille ET un texte** (« confiance élevée »,
   * « proposé par le modèle »), jamais par une nuance de vert ou d'orange (WCAG 2.2 AA, critère
   * 1.4.1). Le pourcentage accompagne le mot, il ne le remplace pas.
   *
   * ## La voie sans modèle est la voie principale
   *
   * Le bouton « Demander à un modèle » n'apparaît que si l'utilisateur a activé la fonction ET
   * collé une clé. Sans lui, l'écran est complet : c'est la proposition déterministe, et elle
   * suffit. Ce que le modèle apporte, quand il est là, est visible ligne par ligne.
   */
  import { fmtDate } from '$lib/format/fr';
  import {
    CHECK_LABELS,
    RULE_LABELS,
    SOURCE_LABELS,
    STATUS_LABELS,
    TARGET_LABELS,
    UNSUPPORTED_LABELS,
    checkReason,
    confidenceLabel,
    confidencePercent,
  } from '$lib/format/mapping';
  import { TARGET_SCHEMA, type MappingTarget } from '$lib/import/mapping/schema';
  import type { MappingProposal } from '$lib/import/mapping/propose';
  import type { MappingVerdict } from '$lib/import/mapping/verify';

  interface Props {
    proposal: MappingProposal;
    /** Champ → index de colonne, lié : c'est CE que l'utilisateur confirme. */
    columns: Partial<Record<MappingTarget, number>>;
    /** Libellé du fichier → étiquette pivot, lié. */
    typeLabels: Record<string, string>;
    /** Verdict du vérificateur sur l'appariement courant ; recalculé à chaque changement. */
    verdict: MappingVerdict;
    /** Le modèle est-il disponible (fonction activée + clé en mémoire) ? */
    modelReady: boolean;
    busy: boolean;
    /** Libellés de type écartés par le filtre de la charge utile — annoncé, jamais tu. */
    droppedTypeLabels: number;
    /** Appariement retrouvé sur le compte (même en-tête), s'il y en a un. */
    rememberedAt: string | null;
    onask: () => void;
    onconfirm: () => void;
    oncancel: () => void;
  }
  let {
    proposal,
    columns = $bindable(),
    typeLabels = $bindable(),
    verdict,
    modelReady,
    busy,
    droppedTypeLabels,
    rememberedAt,
    onask,
    onconfirm,
    oncancel,
  }: Props = $props();

  const assignmentOf = (field: MappingTarget) => proposal.columns.find((c) => c.field === field);

  /** Une colonne déjà prise par un autre champ ne peut pas l'être deux fois. */
  const takenBy = (index: number, field: MappingTarget): MappingTarget | null => {
    for (const [other, column] of Object.entries(columns) as [MappingTarget, number][]) {
      if (other !== field && column === index) return other;
    }
    return null;
  };

  function choose(field: MappingTarget, raw: string): void {
    const next = { ...columns };
    if (raw === '') delete next[field];
    else {
      const index = Number(raw);
      // Un champ au plus par colonne : le précédent occupant est libéré, pas dupliqué.
      for (const [other, column] of Object.entries(next) as [MappingTarget, number][]) {
        if (other !== field && column === index) delete next[other];
      }
      next[field] = index;
    }
    columns = next;
  }

  function chooseLabel(value: string, target: string): void {
    const next = { ...typeLabels };
    if (target === '') delete next[value];
    else next[value] = target;
    typeLabels = next;
  }

  const failure = $derived(verdict.checks.find((c) => c.status === 'fail') ?? null);
  const targetOptions = $derived([
    ...new Set(proposal.typeLabels.map((l) => l.target).filter((t): t is string => t !== null)),
    ...Object.values(typeLabels),
  ]);
</script>

<section class="card block">
  <h2>Quelle colonne est quoi ?</h2>
  <p class="small">
    Ce fichier n’a aucun format connu. L’application a lu ses en-têtes et la forme de ses valeurs,
    et propose l’appariement ci-dessous. <strong
      >Rien n’est importé tant que vous ne l’avez pas confirmé</strong
    > : corrigez ce qui doit l’être, ligne par ligne.
  </p>

  {#if rememberedAt}
    <p class="note" role="note">
      Appariement retrouvé sur ce compte (même en-tête, confirmé le {fmtDate(
        rememberedAt.slice(0, 10),
      )}) : il est déjà appliqué ci-dessous.
    </p>
  {/if}

  {#if proposal.unsupported}
    <p class="warn" role="note">{UNSUPPORTED_LABELS[proposal.unsupported]}</p>
  {/if}

  <ul class="fields">
    {#each TARGET_SCHEMA as spec (spec.field)}
      {@const assignment = assignmentOf(spec.field)}
      {@const chosen = columns[spec.field]}
      <li>
        <label for="map-{spec.field}">
          {TARGET_LABELS[spec.field]}
          {#if spec.role === 'required'}<span class="req">obligatoire</span>{/if}
        </label>
        <select
          id="map-{spec.field}"
          value={chosen === undefined ? '' : String(chosen)}
          onchange={(e) => choose(spec.field, e.currentTarget.value)}
        >
          <option value="">— aucune colonne —</option>
          {#each proposal.headers as header, index (index)}
            {@const taken = takenBy(index, spec.field)}
            <option value={String(index)}>
              {header.raw || `colonne ${index + 1}`}{taken
                ? ` (actuellement : ${TARGET_LABELS[taken]})`
                : ''}
            </option>
          {/each}
        </select>
        {#if assignment && chosen === assignment.column}
          <!-- Pastille ET texte : jamais la couleur seule (WCAG 2.2 AA, critère 1.4.1). -->
          <p class="meta">
            <span class="dot" class:sure={assignment.confidence >= 0.8} aria-hidden="true"></span>
            <span>{confidenceLabel(assignment.confidence)}</span>
            <span class="muted">({confidencePercent(assignment.confidence)})</span>
            <span class="muted">· {SOURCE_LABELS[assignment.source]}</span>
            <span class="muted">· {RULE_LABELS[assignment.rule]}</span>
          </p>
        {:else if chosen !== undefined}
          <p class="meta">
            <span class="dot" aria-hidden="true"></span>
            <span>choisi par vous</span>
          </p>
        {:else}
          <p class="meta">
            <span class="dot" aria-hidden="true"></span>
            <span>non apparié</span>
          </p>
        {/if}
      </li>
    {/each}
  </ul>

  {#if proposal.typeLabels.length > 0}
    <h3>Types d’opération</h3>
    <p class="small muted">
      Un libellé traduit change le traitement : une récompense entre à sa valeur, un cadeau sort au
      coût, une dépense sort au prix de cession. Laissez « — aucune — » si le libellé désigne un
      simple achat ou une vente.
    </p>
    <ul class="fields">
      {#each proposal.typeLabels as label, position (label.value)}
        <li>
          <!-- L'identifiant vient du RANG, pas du libellé : un libellé de fichier porte espaces et
               accents, et un `id` qui en contient rompt la liaison `label for` (donc l'étiquette
               lue par un lecteur d'écran). -->
          <label for="type-{position}">« {label.value} »</label>
          <select
            id="type-{position}"
            value={typeLabels[label.value] ?? ''}
            onchange={(e) => chooseLabel(label.value, e.currentTarget.value)}
          >
            <option value="">— aucune —</option>
            {#each [...new Set(targetOptions)] as target (target)}
              <option value={target}>{target}</option>
            {/each}
          </select>
          <p class="meta">
            <span class="dot" class:sure={label.confidence >= 0.8} aria-hidden="true"></span>
            <span>{label.target === null ? 'non traduit' : confidenceLabel(label.confidence)}</span>
            {#if label.rule}<span class="muted">· {RULE_LABELS[label.rule]}</span>{/if}
            <span class="muted">· {SOURCE_LABELS[label.source]}</span>
          </p>
        </li>
      {/each}
    </ul>
  {/if}

  <h3>Contrôles avant import</h3>
  <ul class="checks small">
    {#each verdict.checks as check (check.id)}
      <li>
        <span class="dot" class:sure={check.status === 'pass'} aria-hidden="true"></span>
        <strong>{CHECK_LABELS[check.id]}</strong> : {STATUS_LABELS[check.status]}
        {#if check.status !== 'pass'}<span class="muted"> — {checkReason(check.code)}</span>{/if}
      </li>
    {/each}
  </ul>
  {#if failure}
    <p class="warn" role="status">{checkReason(failure.code)}</p>
  {/if}

  <div class="actions">
    <button class="primary" type="button" disabled={busy || !verdict.ok} onclick={onconfirm}>
      Importer {verdict.parsedRows} ligne(s) sur {verdict.totalRows}
    </button>
    {#if modelReady}
      <button class="secondary" type="button" disabled={busy} onclick={onask}>
        Demander à un modèle
      </button>
    {/if}
    <button class="secondary" type="button" onclick={oncancel}>Annuler</button>
  </div>
  {#if modelReady}
    <p class="small muted">
      Le modèle ne voit ni vos montants, ni vos dates, ni vos comptes : seulement les en-têtes, la
      forme des colonnes et les libellés de type.
      {#if droppedTypeLabels > 0}
        {droppedTypeLabels} libellé(s) ont été écartés de l’envoi par le filtre (chiffres, adresse, courriel
        ou montant) — écartés entièrement, jamais tronqués.
      {/if}
      Il ne peut que compléter ce qui n’est pas déjà trouvé, jamais remplacer un appariement sûr.
    </p>
  {/if}
</section>

<style>
  .block {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  h3 {
    margin: var(--space-3) 0 0;
    font-size: var(--fs-sm);
  }
  .small {
    font-size: var(--fs-sm);
  }
  .fields {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .fields li {
    display: grid;
    gap: var(--space-1);
  }
  .fields label {
    font-weight: 700;
    font-size: var(--fs-sm);
  }
  .req {
    font-weight: 400;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  select {
    min-height: var(--tap);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    max-width: 100%;
  }
  .meta {
    margin: 0;
    font-size: var(--fs-xs);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  /* La pastille DOUBLE le texte, elle ne le remplace jamais : un lecteur qui ne distingue pas les
     couleurs lit « confiance élevée » ou « à confirmer » en toutes lettres. */
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    border: 1px solid var(--fg-muted);
    display: inline-block;
    flex: none;
  }
  .dot.sure {
    background: var(--fg-muted);
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .checks li {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .note,
  .warn {
    margin: var(--space-1) 0 0;
    font-size: var(--fs-sm);
    border-left: 3px solid var(--border);
    padding-left: var(--space-2);
  }
  .warn {
    border-left-color: var(--warn);
  }
  .actions {
    margin-top: var(--space-3);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-weight: 700;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
    border: 0;
  }
  .secondary {
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
