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
  import SpaceTabs from '../layout/SpaceTabs.svelte';

  export type InvestTab = 'portfolio' | 'titles';
  let { active }: { active: InvestTab } = $props();
  const TABS: { name: InvestTab; label: string }[] = [
    { name: 'portfolio', label: 'Crypto' },
    { name: 'titles', label: 'Actions et ETF' },
  ];
  const tabs = $derived(
    TABS.map((t) => ({
      href: router.href({ name: t.name }),
      label: t.label,
      current: active === t.name,
    })),
  );
</script>

<SpaceTabs ariaLabel="Espace Investissement" {tabs} />
