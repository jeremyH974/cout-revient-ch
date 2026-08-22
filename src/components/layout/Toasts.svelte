<script lang="ts">
  import { toasts } from '../../state/ui.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <button class="toast {toast.kind}" type="button" onclick={() => toasts.dismiss(toast.id)}>
      {toast.text}
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(72px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: 50;
    width: min(92vw, 480px);
  }
  .toast {
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-left: 4px solid var(--info);
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
    text-align: left;
    font-size: var(--fs-sm);
    box-shadow: var(--shadow);
  }
  .toast.success {
    border-left-color: var(--gain);
  }
  .toast.error {
    border-left-color: var(--loss);
  }
</style>
