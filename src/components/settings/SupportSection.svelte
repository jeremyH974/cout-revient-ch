<script lang="ts">
  import { onMount } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { iconFailures } from '$lib/pricing/icons';
  import { buildDiagnostic } from '$lib/support/diagnostic';
  import { collectEnvironment, type EnvironmentSnapshot } from '$lib/support/environment';
  import { NEW_ISSUE_URL } from '$lib/support/links';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  interface Props {
    /** Échec d'import affiché sur la page Importer (colonnes trouvées, jamais les lignes). */
    failure?: { error: string; header: readonly string[] } | null;
    intro?: string;
  }
  let { failure = null, intro = '' }: Props = $props();

  let snapshot = $state<EnvironmentSnapshot | null>(null);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  onMount(() => {
    void collectEnvironment().then((s) => (snapshot = s));
  });

  const text = $derived.by(() =>
    buildDiagnostic({
      version: __APP_VERSION__,
      build: __BUILD_SHA__,
      now: nowIso(),
      environment: snapshot?.environment ?? {
        userAgent: '?',
        language: '?',
        viewport: '?',
        online: null,
        standalone: null,
      },
      storage: {
        status: app.loadStatus,
        saveError: app.saveError,
        persisted: snapshot?.storage.persisted ?? null,
        usageBytes: snapshot?.storage.usageBytes ?? null,
        quotaBytes: snapshot?.storage.quotaBytes ?? null,
      },
      imports: app.state.imports,
      rows: Object.values(app.state.rawRows),
      manualEvents: Object.keys(app.state.manualEvents).length,
      report: app.hasData ? app.report : null,
      prices: {
        source: app.state.ui.priceSource,
        online: app.priceStatus.online,
        errors: app.priceStatus.errors,
        missing: app.priceStatus.missing,
        lastRefreshAt: app.priceStatus.lastRefreshAt,
      },
      fx: {
        wanted: app.state.ui.displayCurrency,
        effective: app.currency,
        error: app.fxStatus.error,
      },
      engine: app.state.engineSettings,
      ui: app.state.ui,
      failure,
      iconFailures,
    }),
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toasts.push('Diagnostic copié : collez-le dans votre message.', 'success');
    } catch {
      textarea?.select();
      const ok = document.execCommand('copy');
      toasts.push(
        ok
          ? 'Diagnostic copié : collez-le dans votre message.'
          : 'Copie impossible : sélectionnez le texte ci-dessous.',
        ok ? 'success' : 'error',
      );
    }
  }
</script>

<div class="support">
  {#if intro}<p class="muted small">{intro}</p>{/if}
  <div class="row">
    <button class="secondary" type="button" onclick={() => void copy()}>Copier le diagnostic</button
    >
    <a class="secondary" href={NEW_ISSUE_URL} target="_blank" rel="noopener noreferrer"
      >Signaler un problème ou une idée</a
    >
  </div>
  <details>
    <summary class="small">Voir le diagnostic (ni montant ni quantité)</summary>
    <textarea bind:this={textarea} readonly rows="12" aria-label="Diagnostic" value={text}
    ></textarea>
  </details>
</div>

<style>
  .support {
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg);
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }
  .small {
    font-size: var(--fs-xs);
  }
  summary {
    cursor: pointer;
    color: var(--fg-muted);
  }
  textarea {
    width: 100%;
    margin-top: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--fs-xs);
    line-height: 1.4;
    resize: vertical;
  }
</style>
