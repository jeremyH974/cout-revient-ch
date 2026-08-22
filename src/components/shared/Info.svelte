<script lang="ts">
  import type { Snippet } from 'svelte';
  import Sheet from './Sheet.svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
  let open = $state(false);
</script>

<button
  class="info"
  type="button"
  onclick={() => (open = true)}
  aria-label="Comment c'est calculé : {title}">i</button
>
<Sheet bind:open {title}>{@render children()}</Sheet>

<style>
  .info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--fg-faint);
    color: var(--fg-muted);
    font-size: 12px;
    font-weight: 700;
    font-family: var(--font-mono);
    vertical-align: middle;
    margin-left: 4px;
  }
  .info:hover {
    color: var(--fg);
    border-color: var(--fg);
  }
</style>
