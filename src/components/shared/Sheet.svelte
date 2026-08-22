<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    children,
  }: { open?: boolean; title: string; children: Snippet } = $props();
  let dialog = $state<HTMLDialogElement | undefined>();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  onclose={() => (open = false)}
  onclick={(event) => {
    if (event.target === dialog) open = false;
  }}
>
  <div class="panel">
    <header>
      <h2>{title}</h2>
      <button class="close" type="button" onclick={() => (open = false)} aria-label="Fermer"
        >✕</button
      >
    </header>
    <div class="body">{@render children()}</div>
  </div>
</dialog>

<style>
  .sheet {
    border: 0;
    padding: 0;
    background: transparent;
    width: 100%;
    max-width: 100%;
    margin: auto 0 0;
    max-height: 90vh;
  }
  .sheet::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  .panel {
    background: var(--bg-elev);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
    padding: var(--space-4) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom));
    max-height: 90vh;
    overflow: auto;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .close {
    min-width: var(--tap);
    min-height: var(--tap);
    color: var(--fg-muted);
    font-size: var(--fs-lg);
  }
  .body {
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
  .body :global(p + p) {
    margin-top: var(--space-2);
  }
  .body :global(code) {
    font-family: var(--font-mono);
    font-size: 0.95em;
    background: var(--bg-sunken);
    padding: 1px 4px;
    border-radius: 4px;
  }
  @media (min-width: 768px) {
    .sheet {
      margin: auto;
      max-width: 560px;
    }
    .panel {
      border-radius: var(--radius);
    }
  }
</style>
