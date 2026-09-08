<script lang="ts">
  /**
   * Sous-navigation de l'espace Investissement : les deux familles d'actifs **cotés**, crypto et
   * titres. Elles partagent le moteur, le prix de revient moyen pondéré et les écrans ; ce qui les
   * sépare est leur régime fiscal (150 VH bis contre 150-0 D, décision n° 119), pas leur nature de
   * placement. D'où deux volets d'un même espace, et non deux espaces.
   *
   * La route `asset` n'appartient à aucun des deux : **elle est partagée**, et l'onglet actif s'y
   * dérive de la classe de l'actif affiché — un titre ouvert depuis Actions ne doit pas renvoyer
   * l'utilisateur au portefeuille crypto.
   */
  import { router } from '$lib/router.svelte';

  export type InvestTab = 'portfolio' | 'titles';
  let { active }: { active: InvestTab } = $props();
  const TABS: { name: InvestTab; label: string }[] = [
    { name: 'portfolio', label: 'Crypto' },
    { name: 'titles', label: 'Actions et ETF' },
  ];
</script>

<nav class="tabs" aria-label="Espace Investissement">
  {#each TABS as tab (tab.name)}
    <a
      href={router.href({ name: tab.name })}
      aria-current={active === tab.name ? 'page' : undefined}>{tab.label}</a
    >
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    margin-bottom: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    width: fit-content;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
  }
  a[aria-current='page'] {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: var(--shadow);
  }
</style>
