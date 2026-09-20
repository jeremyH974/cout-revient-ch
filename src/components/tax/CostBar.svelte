<script lang="ts">
  /**
   * La barre d'une voie d'imposition : impôt sur le revenu, puis prélèvements sociaux
   * (décision n° 170).
   *
   * **L'échelle est commune aux deux cartes** (`scaleMaxEur`) : deux barres qui rempliraient
   * chacune leur carte diraient le contraire de ce qu'elles montrent — la plus chère paraîtrait
   * égale à la moins chère. C'est le seul réglage qui compte ici.
   *
   * **Elle est `aria-hidden`.** Elle n'ajoute rien qu'un lecteur d'écran n'ait déjà : les deux
   * montants sont écrits en toutes lettres juste à côté. Les deux segments se distinguent par une
   * **hachure**, jamais par la seule couleur (WCAG 1.4.1).
   */
  import { D, ZERO, type DecimalString } from '$lib/domain/money';

  interface Props {
    incomeTaxEur: DecimalString;
    socialTaxEur: DecimalString;
    /** Le plus grand des totaux comparés — jamais celui de cette carte seule. */
    scaleMaxEur: DecimalString;
  }
  let { incomeTaxEur, socialTaxEur, scaleMaxEur }: Props = $props();

  /** Largeur en pourcentage, calculée en décimal : un montant ne passe jamais par un `number`. */
  const width = (amountEur: DecimalString): string => {
    const max = D(scaleMaxEur);
    if (!max.gt(ZERO)) return '0';
    const share = D(amountEur).div(max).times(D('100'));
    return (share.gt(D('100')) ? D('100') : share.lt(ZERO) ? ZERO : share).toFixed(2);
  };
</script>

<div class="bar" aria-hidden="true">
  <span class="seg income" style:width="{width(incomeTaxEur)}%"></span>
  <span class="seg social" style:width="{width(socialTaxEur)}%"></span>
</div>

<style>
  .bar {
    display: flex;
    overflow: hidden;
    height: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .seg {
    display: block;
    height: 100%;
  }
  .income {
    background: var(--accent);
  }
  /* Hachures : la part qui ne s'arbitre pas se reconnaît sans distinguer les couleurs. */
  .social {
    background: repeating-linear-gradient(
      135deg,
      var(--fg-faint) 0,
      var(--fg-faint) 3px,
      transparent 3px,
      transparent 6px
    );
  }
</style>
