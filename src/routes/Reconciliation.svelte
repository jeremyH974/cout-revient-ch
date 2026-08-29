<script lang="ts">
  /**
   * Réconciliation (P68) : écarts, trous et doublons, présentés en liste d'actions. L'écran ne
   * calcule rien — il lit `checks.dataReconciliation` (déjà assemblé par `state/checks.svelte.ts`)
   * et rend chaque item via `format/reconciliation.ts`. Groupé par sévérité : un échec (`fail`)
   * invalide les chiffres et doit se voir avant tout le reste, un avertissement (`warn`) demande une
   * action mais ne fausse rien, une information (`info`) ne demande rien d'urgent.
   *
   * `Settings.svelte` / `SelfChecks.svelte` restent la vue TECHNIQUE (sauvegarde, PWA, prix) : cet
   * écran ne montre que ce qui est actionnable sur les DONNÉES — c'est cette séparation, pas une
   * troncature arbitraire, qui évite de noyer l'utilisateur.
   *
   * Déclencheur « Pourquoi ce chiffre ? » : contrairement à la fiche actif (P61), un item de
   * réconciliation n'enveloppe presque jamais un montant déjà affiché (c'est souvent son ABSENCE —
   * pas de cours, pas de coût — qui motive l'item). Le bouton porte donc son intitulé en clair
   * plutôt que d'envelopper un chiffre inexistant ; la cible ≥ 24 px (WCAG 2.2 `target-size`) vient
   * du remplissage du bouton, pas d'une icône « ? ».
   */
  import { onMount } from 'svelte';
  import type { TraceTarget } from '$lib/domain/engine';
  import {
    duplicatePairKey,
    type ReconciliationItem,
    type ReconciliationSeverity,
  } from '$lib/domain/reconciliation';
  import {
    reconciliationToText,
    renderReconciliation,
    type RenderedReconciliationItem,
  } from '$lib/format/reconciliation';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import WhySheet from '../components/shared/WhySheet.svelte';
  import { app } from '../state/app.svelte';
  import { checks } from '../state/checks.svelte';
  import { history } from '../state/history.svelte';
  import { toasts } from '../state/ui.svelte';

  // La fiscalité (`price-gap-at-cession`) a besoin de l'historique quotidien des prix ; sans lui,
  // la règle se tait plutôt que d'inventer une valeur (même garde que `Report.svelte`).
  onMount(() => void history.ensure());

  const items = $derived(checks.dataReconciliation.items);
  const rendered = $derived(
    renderReconciliation(items, {
      discreet: app.state.ui.discreet,
      currency: app.currency,
      accountLabels: app.accountLabels,
    }),
  );
  /** Item codé et item rendu, alignés : `renderReconciliation` conserve l'ordre et la longueur. */
  const cards = $derived(items.map((raw, i) => ({ raw, view: rendered[i]! })));

  const SEVERITY_ORDER: readonly ReconciliationSeverity[] = ['fail', 'warn', 'info'];
  const SEVERITY_LABEL: Record<ReconciliationSeverity, string> = {
    fail: 'À corriger',
    warn: 'À surveiller',
    info: 'Pour information',
  };
  const groups = $derived(
    SEVERITY_ORDER.map((severity) => ({
      severity,
      list: cards.filter((c) => c.view.severity === severity),
    })).filter((g) => g.list.length > 0),
  );

  let whyOpen = $state(false);
  let whyTarget = $state<TraceTarget>({ metric: 'total', scope: { kind: 'portfolio' } });
  function openWhy(raw: ReconciliationItem): void {
    if (!raw.evidence.trace) return;
    whyTarget = raw.evidence.trace;
    whyOpen = true;
  }

  /** Chaque action navigue vers l'écran qui sait déjà la traiter — aucun écran n'est dupliqué ici. */
  function act(raw: ReconciliationItem): void {
    const action = raw.action;
    switch (action.code) {
      case 'qualify-rows':
        router.navigate({ name: 'import' });
        return;
      case 'reimport-export': {
        const account = action.accountId
          ? app.accounts.find((a) => a.id === action.accountId)
          : undefined;
        if (account?.kind === 'hyperliquid') void app.syncHyperliquid(account.id);
        else router.navigate({ name: 'import' });
        return;
      }
      case 'set-manual-price':
        if (action.asset) router.navigate({ name: 'asset', asset: action.asset });
        return;
      case 'enter-opening-balance':
        router.navigate({ name: 'add' });
        return;
      case 'pair-or-value-transfer':
      case 'set-account-country':
        router.navigate({ name: 'accounts' });
        return;
      case 'review-duplicate':
      case 'none':
        // Le doublon se tranche avec les deux boutons dédiés ; « none » n'a pas de bouton (voir
        // `format/reconciliation.ts`, `actionLabel` y est vide).
        return;
    }
  }

  /** Jamais de suppression automatique (arbitrage P68) : l'utilisateur confirme ou écarte. */
  function reviewDuplicate(raw: ReconciliationItem, review: 'confirmed' | 'dismissed'): void {
    const [a, b] = raw.evidence.eventIds;
    if (!a || !b) return;
    app.setDuplicateReview(duplicatePairKey(a, b), review);
    toasts.push(
      review === 'confirmed'
        ? 'Doublon confirmé : il ne sera plus proposé (vos données ne sont pas modifiées).'
        : 'Doublon écarté : il ne sera plus proposé.',
      'success',
    );
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(reconciliationToText(rendered));
      toasts.push('Constats copiés : collez-les où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }

  function labelId(item: RenderedReconciliationItem): string {
    return `recon-${item.id}`;
  }
</script>

<AppBar title="Réconciliation" back={app.hasData} />

{#if !app.hasData}
  <section class="card empty">
    <p class="muted">
      Importez votre export ou ajoutez une opération : la réconciliation compare vos données une
      fois qu'il y en a.
    </p>
  </section>
{:else if cards.length === 0}
  <section class="card empty ok">
    <h2>Rien à signaler</h2>
    <p class="muted">Aucun écart, trou ni doublon détecté sur vos données actuelles.</p>
  </section>
{:else}
  <p class="tools">
    <button class="tool" type="button" onclick={() => void copy()}>Copier la liste</button>
  </p>
  {#each groups as group (group.severity)}
    <section class="card group {group.severity}" aria-labelledby="recon-group-{group.severity}">
      <h2 id="recon-group-{group.severity}">
        {SEVERITY_LABEL[group.severity]} ({group.list.length})
      </h2>
      <ul class="items">
        {#each group.list as card (card.raw.id)}
          <li aria-labelledby={labelId(card.view)}>
            <p class="head">
              <strong id={labelId(card.view)}>{card.view.title}</strong>
              {#if card.view.assetLabel}<span class="chip">{card.view.assetLabel}</span>{/if}
              {#if card.view.accountLabel}<span class="chip muted">{card.view.accountLabel}</span
                >{/if}
            </p>
            <p>{card.view.detail}</p>
            {#if card.view.gapLabel}<p class="muted small">{card.view.gapLabel}</p>{/if}
            <p class="muted small">{card.view.evidenceLabel}</p>
            <div class="actions">
              {#if card.raw.evidence.trace}
                <button class="link" type="button" onclick={() => openWhy(card.raw)}
                  >Pourquoi ce chiffre ?</button
                >
              {/if}
              {#if card.raw.code === 'duplicate-candidate'}
                <button
                  class="tool"
                  type="button"
                  onclick={() => reviewDuplicate(card.raw, 'confirmed')}>C’est un doublon</button
                >
                <button
                  class="tool"
                  type="button"
                  onclick={() => reviewDuplicate(card.raw, 'dismissed')}>Pas un doublon</button
                >
              {:else if card.view.actionLabel}
                <button class="primary" type="button" onclick={() => act(card.raw)}
                  >{card.view.actionLabel}</button
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{/if}

<WhySheet bind:open={whyOpen} target={whyTarget} />

<style>
  section.card {
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .muted {
    color: var(--fg-muted);
  }
  .small {
    font-size: var(--fs-sm);
  }
  .empty {
    text-align: center;
  }
  .empty.ok {
    border-left: 4px solid var(--gain);
  }
  .tools {
    display: flex;
    justify-content: flex-end;
  }
  .group.fail {
    border-left: 4px solid var(--loss);
  }
  .group.warn {
    border-left: 4px solid var(--warn);
  }
  .group.info {
    border-left: 4px solid var(--info);
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
    margin: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 700;
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
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
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
