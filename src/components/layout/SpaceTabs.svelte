<script lang="ts">
  /**
   * Barre de sous-navigation partagée par les espaces à plusieurs écrans (Investissement,
   * Trading) : des LIENS entre pages, jamais des panneaux d'une même page — d'où `nav` +
   * `a[aria-current="page"]`, et non le motif ARIA tablist (décision n° 158 puis n° 181).
   *
   * Une seule ligne, toujours (recommandation Material 3 pour les onglets : jamais deux lignes).
   * Sur un téléphone étroit, la barre ne pousse pas la page
   * ni ne passe à la ligne : elle défile horizontalement, l'onglet courant ramené en vue au
   * montage, avec une ombre de débordement en CSS pur de part et d'autre.
   *
   * Chaque appelant calcule son propre `href` et son propre `current` (TradingTabs, par exemple,
   * garde sa logique de libellés et de route active) : ce composant ne connaît que la présentation.
   */
  import { onMount } from 'svelte';

  interface Tab {
    href: string;
    label: string;
    current: boolean;
  }
  let { ariaLabel, tabs }: { ariaLabel: string; tabs: readonly Tab[] } = $props();

  let nav: HTMLElement | undefined = $state();

  onMount(() => {
    nav
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<nav class="tabs" aria-label={ariaLabel} bind:this={nav}>
  {#each tabs as tab (tab.href)}
    <a href={tab.href} aria-current={tab.current ? 'page' : undefined} class:current={tab.current}
      >{tab.label}</a
    >
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    margin-bottom: var(--space-3);
    background-color: var(--bg-sunken);
    border-radius: var(--radius-sm);
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
    /*
     * Ombres de débordement en CSS pur, sans JS : deux couches masquent (`local`, calées sur le
     * contenu défilant) et deux couches ombrent (`scroll`, calées sur la boîte). Au repos, le
     * masque recouvre exactement l'ombre ; dès que le début ou la fin défile hors champ, le masque
     * s'en va avec lui et l'ombre apparaît. Technique : background-attachment: local.
     */
    background-repeat: no-repeat;
    background-size:
      24px 100%,
      24px 100%,
      8px 100%,
      8px 100%;
    background-position:
      0 0,
      100% 0,
      0 0,
      100% 0;
    background-attachment: local, local, scroll, scroll;
    background-image:
      linear-gradient(to right, var(--bg-sunken), var(--bg-sunken)),
      linear-gradient(to left, var(--bg-sunken), var(--bg-sunken)),
      linear-gradient(to right, var(--border), transparent),
      linear-gradient(to left, var(--border), transparent);
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  a {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    scroll-snap-align: start;
    min-height: 36px;
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
  }
  a.current {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: var(--shadow);
  }
  /* Cible tactile pleine (44 px) au doigt, plus compacte (36 px) à la souris/au stylet. */
  @media (any-pointer: coarse) {
    a {
      min-height: var(--tap);
    }
  }
</style>
