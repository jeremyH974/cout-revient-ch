<script lang="ts">
  /**
   * Les réserves d'un chiffrage forfait / barème, écrites **une fois** (décision n° 170).
   *
   * Elles paraissent sur deux écrans — la Déclaration, qui chiffre vite à une tranche donnée, et
   * l'écran Impôts, qui applique le barème au foyer. Deux copies de ces phrases divergeraient au
   * premier amendement, et c'est précisément le genre de texte dont une version périmée trompe :
   * il dit ce que le chiffre **ne** prouve **pas**.
   *
   * Le composant rend des `<li>` : l'appelant fournit la liste et son style.
   */
  import type { Arbitrage } from '$lib/derive/pfu-vs-bareme';
  import { fmtEur } from '$lib/format/fr';

  interface Props {
    arbitrage: Arbitrage;
    /**
     * `'bracket'` : la tranche vient de l'utilisateur et l'écart la suppose immobile.
     * `'household'` : le barème s'applique au revenu réel, franchissement compris — la réserve
     * sur la tranche n'a alors plus lieu d'être, et la maintenir serait un faux aveu d'ignorance.
     */
    mode: 'bracket' | 'household';
    discreet?: boolean;
  }
  let { arbitrage, mode, discreet = false }: Props = $props();
  const eur = (amount: string): string => (discreet ? 'masqué' : fmtEur(amount));
</script>

{#if arbitrage.option === '2OP'}
  <li>
    <strong>Cette option est globale.</strong> Elle bascule d’un coup tous les revenus de capitaux mobiliers
    du foyer, pour l’année entière — on ne peut pas la réserver aux dividendes, dont l’abattement la rend
    attrayante, en laissant les intérêts au forfait.
  </li>
{/if}
<li>
  {#if arbitrage.revocable}
    Depuis la loi de finances pour 2026, cette option n’est plus irrévocable : se tromper coûte
    moins cher qu’avant.
  {:else}
    <strong>Celle-ci reste irrévocable.</strong> La loi de finances pour 2026 n’a levé ce caractère que
    pour la case 2OP ; l’article qui régit celle-ci dit toujours « option expresse et irrévocable ». Une
    fois exercée pour l’année, on ne revient pas dessus.
  {/if}
</li>
<li>
  Ce total ne compte que les revenus que cette application connaît. Un autre revenu de capitaux
  mobiliers, ailleurs, déplacerait l’écart.
</li>
{#if mode === 'bracket'}
  <li>
    L’écart suppose que votre tranche <em>reste</em> celle indiquée. Ajouter ces revenus à votre revenu
    global peut vous en faire changer : l’écran Impôts le calcule pour de bon si vous lui donnez votre
    revenu et vos parts.
  </li>
{:else}
  <li>
    Ni la décote ni le plafonnement du quotient familial ne sont modélisés. Le plafonnement s’annule
    dans une différence ; <strong>la décote, non</strong> — près des seuils, l’écart réel peut différer.
  </li>
{/if}
<li>
  La CSG déductible retenue ici ({eur(arbitrage.csgDeductibleEur)}) réduit le revenu
  <em>de l’année où elle est payée</em> : pour un revenu recouvré par avis, le gain arrive sur la déclaration
  suivante.
</li>
{#if arbitrage.bases.some((b) => b.family === 'equity')}
  <li>
    Aucun abattement pour durée de détention n’est appliqué. Si vous détenez des titres acquis
    <strong>avant 2018</strong>, le barème peut rester avantageux bien au-delà de cette tranche — ce
    cas sort de ce que l’application sait calculer.
  </li>
{/if}
<li>
  L’option modifie aussi votre revenu fiscal de référence, dont dépendent d’autres droits. Ce
  chiffrage ne le regarde pas.
</li>
