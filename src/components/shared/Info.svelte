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
    position: relative;
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
  /*
   * Zone cliquable agrandie par pseudo-élément plutôt que par le rond visuel (WCAG 2.2 SC 2.5.8,
   * target-size-minimum) : le glyphe reste un cercle de 22 px, mais la cible réelle est ≥ 24 px
   * partout et ≥ 44 px (var(--tap)) au doigt. `position: absolute` ne modifie pas la mise en page —
   * seulement l'aire cliquable, y compris dans un titre où l'icône est en ligne avec du texte.
   */
  .info::before {
    content: '';
    position: absolute;
    inset: -1px;
  }
  @media (any-pointer: coarse) {
    .info::before {
      inset: -11px;
    }
  }
</style>
