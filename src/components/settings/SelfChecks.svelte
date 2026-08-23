<script lang="ts">
  import { nowIso } from '$lib/clock';
  import { isIOS, isStandalone } from '$lib/support/environment';
  import { runSelfChecks, summarize, type CheckLevel } from '$lib/support/self-check';
  import { app } from '../../state/app.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  const checks = $derived(
    runSelfChecks({
      report: app.hasData ? app.report : null,
      quotes: app.quotes,
      prices: {
        source: app.state.ui.priceSource,
        online: app.priceStatus.online,
        lastRefreshAt: app.priceStatus.lastRefreshAt,
      },
      storage: {
        lastBackupAt: app.state.ui.lastBackupAt,
        persisted: null,
        saveError: app.saveError,
      },
      platform: { ios: isIOS(), standalone: isStandalone() },
      trading: app.tradingChecks,
      now: nowIso(),
    }),
  );
  const summary = $derived(summarize(checks));
  const ICON: Record<CheckLevel, string> = { ok: '✓', warn: '!', fail: '✕', info: 'i' };
  const WORD: Record<CheckLevel, string> = {
    ok: 'vérifié',
    warn: 'à surveiller',
    fail: 'anomalie',
    info: 'information',
  };
</script>

{#if compact}
  <span class="badge {summary.worst}" title="Vérifications automatiques (Réglages)">
    {#if summary.worst === 'ok'}
      Contrôles {summary.ok}/{summary.total} ✓
    {:else if summary.worst === 'fail'}
      ✕ Anomalie détectée
    {:else}
      ! {summary.total - summary.ok} point{summary.total - summary.ok > 1 ? 's' : ''} à voir
    {/if}
  </span>
{:else}
  <ul class="checks" aria-label="Vérifications automatiques">
    {#each checks as c (c.id)}
      <li class={c.level}>
        <span class="icon" aria-hidden="true">{ICON[c.level]}</span>
        <div>
          <p class="head">
            <strong>{c.label}</strong>
            <span class="sr-only"> : {WORD[c.level]}</span>
          </p>
          <p class="detail">{c.detail}</p>
          {#if c.action}<p class="action">→ {c.action}</p>{/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-3);
    align-items: start;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: var(--fs-xs);
    font-weight: 700;
    background: var(--bg-sunken);
    color: var(--fg-muted);
  }
  .ok .icon {
    background: var(--gain);
    color: #0b2912;
  }
  .warn .icon {
    background: #fbbf24;
    color: #1a1208;
  }
  .fail .icon {
    background: var(--loss);
    color: #fff;
  }
  p {
    margin: 0;
  }
  .head {
    font-size: var(--fs-sm);
  }
  .detail,
  .action {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .action {
    color: var(--fg);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    text-decoration: none;
  }
  .badge.fail {
    border-color: var(--loss);
    color: var(--loss);
  }
  .badge.warn {
    border-color: #fbbf24;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
