<script lang="ts">
  /**
   * L'addition, et sa date (décision n° 173).
   *
   * Les deux cartes de l'écran comparent chacune deux voies ; aucune ne dit ce que **tout** cela
   * fait ensemble, ni ce qu'il en reste une fois retranché ce qui a déjà été prélevé. C'est ce que
   * cette carte rend, et c'est la première chose qu'on lit — d'où sa place, avant les comparatifs.
   *
   * **Tout le calcul vit dans `$lib/derive/tax-bill.ts`.** Ici, on affiche : chaque ligne passe par
   * `fmtEur`, qui arrondit exactement comme le module a arrondi pour établir `displayDueEur`. Les
   * lignes s'additionnent donc sous les yeux du lecteur, et le total qu'il voit est celui sur
   * lequel se juge l'étalement (décision n° 150).
   *
   * **Il ne recommande rien.** La voie retenue part sur « la moins chère », ce qui est un constat
   * sur les seuls revenus connus — l'écran l'écrit — et non une recommandation de cocher quoi que
   * ce soit. Elle se change, et le choix se retient.
   */
  import type { TaxOption } from '$lib/derive/pfu-vs-bareme';
  import type { BillOption, TaxBill } from '$lib/derive/tax-bill';
  import type { TaxSide } from '$lib/derive/tax-choice';
  import { D, ZERO, type DecimalString } from '$lib/domain/money';
  import { fmtEur, fmtEurWhole } from '$lib/format/fr';

  interface Props {
    bill: TaxBill;
    /** Les options telles que l'écran les montre, pour étiqueter les voies avec leur coût. */
    options: readonly BillOption[];
    /**
     * Plus-value latente du portefeuille, en euros — `null` quand elle n'est pas connue. Elle
     * n'entre dans aucun total : elle est là pour dire **pourquoi** elle n'y entre pas.
     */
    latentEur?: DecimalString | null;
    discreet?: boolean;
    onSide: (option: TaxOption, key: TaxSide['key'] | null) => void;
  }
  let { bill, options, latentEur = null, discreet = false, onSide }: Props = $props();

  const OPTION_LABELS: Record<TaxOption, string> = {
    '3CN': 'Plus-values de crypto-actifs',
    '2OP': 'Revenus de capitaux mobiliers',
  };

  const eur = (amount: DecimalString): string => (discreet ? 'masqué' : fmtEur(amount));

  const settlement = $derived(bill.settlement);
  const latent = $derived(latentEur === null ? null : D(latentEur));

  /** Le choix courant d'une option, tel qu'il doit apparaître dans la liste déroulante. */
  const currentValue = (option: TaxOption): string => {
    const side = bill.sides.find((s) => s.option === option);
    if (side === undefined || side.followsCheapest) return '';
    return side.key;
  };

  const dues = $derived(bill.lines.filter((l) => l.kind === 'due'));
  const settled = $derived(bill.lines.filter((l) => l.kind === 'settled'));
</script>

<section class="card bill">
  <h2>Ce qu’il restera à payer</h2>

  <p class="headline" role="status">
    {#if discreet}
      <span class="amount">masqué</span>
    {:else if settlement.direction === 'refund'}
      <span class="amount">{fmtEur(settlement.amountEur)}</span>
      <span class="what">à vous être restitué</span>
    {:else if settlement.direction === 'none'}
      <span class="amount">Rien</span>
      <span class="what">à régler au titre de {bill.year}</span>
    {:else}
      <span class="amount">{fmtEur(bill.displayDueEur)}</span>
      <span class="what">au titre de {bill.year}</span>
    {/if}
  </p>

  <p class="when">
    {#if settlement.direction === 'refund'}
      L’acompte déjà retenu dépasse l’impôt dû : l’excédent est <strong>restitué</strong>, après la
      déclaration du printemps {settlement.year}.
    {:else if settlement.direction === 'none'}
      Il reste à déclarer au printemps {settlement.year} : une année sans impôt n’est pas une année sans
      déclaration.
    {:else if settlement.instalments > 1}
      Déclaration au printemps <strong>{settlement.year}</strong>, avis à l’été. Au-delà de
      {fmtEurWhole(settlement.thresholdEur)}, le solde est étalé d’office en
      <strong>{settlement.instalments} prélèvements d’égal montant</strong>, de septembre à
      décembre.
    {:else}
      Déclaration au printemps <strong>{settlement.year}</strong>, avis à l’été, solde prélevé
      <strong>en une fois</strong>, à partir du 25 septembre.
    {/if}
  </p>

  <p class="muted small">
    Ces revenus échappent au prélèvement à la source : rien n’en est retenu au fil de l’année, et
    ils arrivent entiers sur l’avis.
  </p>

  {#if options.length > 0}
    <div class="sides">
      {#each options as { option, choice } (option)}
        <label>
          Voie retenue — {OPTION_LABELS[option]}
          <select
            value={currentValue(option)}
            onchange={(event) =>
              onSide(
                option,
                event.currentTarget.value === ''
                  ? null
                  : (event.currentTarget.value as TaxSide['key']),
              )}
          >
            <option value="">La moins chère</option>
            <option value="flat">{choice.flat.label}</option>
            <option value="scale">{choice.scale.label}</option>
          </select>
        </label>
      {/each}
    </div>
    <p class="muted small">
      « La moins chère » est un <strong>constat</strong> sur les seuls revenus que cette application connaît,
      jamais une recommandation de cocher quoi que ce soit.
    </p>
  {/if}

  <table>
    <caption class="sr-only">Ce qui est dû, ce qui a déjà été prélevé, et le solde</caption>
    <thead>
      <tr>
        <th scope="col">Ligne</th>
        <th scope="col">Montant</th>
      </tr>
    </thead>
    <tbody>
      {#each dues as line (line.key)}
        <tr>
          <th scope="row">{line.label}</th>
          <td>{eur(line.amountEur)}</td>
        </tr>
      {/each}
      {#each settled as line (line.key)}
        <tr class="settled">
          <th scope="row">{line.label}</th>
          <td>{eur(line.amountEur)}</td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <th scope="row">Solde</th>
        <td>{eur(bill.displayDueEur)}</td>
      </tr>
    </tfoot>
  </table>

  {#if latent !== null && !latent.eq(ZERO)}
    <p class="latent small">
      {#if latent.gt(ZERO)}
        <strong>{eur(latentEur ?? '0')} de plus-value latente</strong> ne figurent nulle part ci-dessus
        : une plus-value ne s’impose qu’à la cession. Tant que vous ne vendez pas, elle ne doit rien.
      {:else}
        <strong>{eur(latentEur ?? '0')} de moins-value latente</strong> ne figurent nulle part ci-dessus
        : tant qu’elle n’est pas réalisée, elle ne s’impute sur rien.
      {/if}
    </p>
  {/if}

  <ul class="caveats small">
    {#each bill.caveats as caveat (caveat)}
      <li>{caveat}</li>
    {/each}
  </ul>

  <p class="note small">
    Ce chiffrage ne dépend que des données que vous avez indiquées. Il ne constitue ni une
    déclaration, ni un conseil.
  </p>
</section>

<style>
  section.card {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .headline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
  }
  .amount {
    font-size: var(--fs-xl);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .what {
    color: var(--fg-muted);
  }
  .when {
    margin: 0;
  }
  .sides {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .sides label {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  td {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  tr.settled th,
  tr.settled td {
    color: var(--fg-muted);
  }
  /* Un trait AU-DESSUS du solde, pas en dessous : sans lui, le total se lit comme une troisième
     ligne de la facture au lieu de la somme des deux précédentes. */
  tfoot th,
  tfoot td {
    border-top: 2px solid var(--border);
    border-bottom: 0;
    font-weight: 600;
  }
  .latent {
    margin: 0;
  }
  .caveats {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-4);
    color: var(--fg-muted);
  }
  .note {
    margin: 0;
    padding: var(--space-2);
    border-left: 3px solid var(--warn);
    background: var(--bg-sunken);
  }
  .small {
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--fg-muted);
  }
  p {
    margin: 0;
  }
</style>
