<script lang="ts">
  /**
   * « Et si je vendais d'ici le 31 décembre ? » (décision n° 171).
   *
   * Le seul geste fiscal encore possible sur l'année en cours. Tout le calcul est dans
   * `$lib/derive/tax-forecast.ts` ; ce composant saisit une hypothèse et affiche le résultat.
   *
   * **Un champ, pas un curseur.** Le GOV.UK Design System déconseille les curseurs de plage
   * (« difficult for some users to interact with ») et WCAG 2.5.1 impose une alternative au
   * glisser-déposer ; NN/g les donne pour imprécis par construction. Un curseur poserait en outre
   * un problème propre à cet écran : sa position de départ **est** une suggestion de montant, et
   * un défaut se lit comme une recommandation (NN/g, *The Anchoring Principle*). Le champ part
   * donc **vide**, et l'application ne propose jamais de montant.
   *
   * **La valeur globale du portefeuille se corrige.** La loi la définit au niveau du **foyer
   * fiscal**, tous supports confondus (CGI art. 150 VH bis, III-C ; BOI-RPPM-PVBMC-30-20 § 140) ;
   * l'application ne connaît que ce qu'on lui a importé. Elle n'est donc pas mémorisée : elle
   * bouge tous les jours, et un report périmé serait pire qu'une ressaisie.
   *
   * **Le résultat visible se met à jour à chaque frappe ; l'annonce aux lecteurs d'écran, non.**
   * Une région `role="status"` qui parlerait à chaque caractère serait inutilisable (MDN, *ARIA
   * live regions* : éviter les mises à jour trop fréquentes). Le résumé parlé est donc différé.
   */
  import { forecastCession, type Forecast } from '$lib/derive/tax-forecast';
  import { taxChoice, type TaxBasis, type TaxChoice } from '$lib/derive/tax-choice';
  import type { TaxReturnInput } from '$lib/derive/tax-return';
  import { D, ZERO, parseDecimal, toDecimalString, type DecimalString } from '$lib/domain/money';
  import { displayGap, fmtEur, fmtRate, roundHalfUp } from '$lib/format/fr';

  interface Props {
    input: TaxReturnInput;
    basis: TaxBasis | null;
    /** Valeur du portefeuille que l'application connaît, en euros ; `null` si elle l'ignore. */
    knownGlobalValueEur: DecimalString | null;
    discreet: boolean;
  }
  let { input, basis, knownGlobalValueEur, discreet }: Props = $props();

  /** Délai avant l'annonce parlée, en millisecondes. Assez pour laisser finir de taper. */
  const SPEAK_AFTER_MS = 600;

  let proceedsRaw = $state('');
  let feesRaw = $state('');
  /**
   * La correction de l'utilisateur, ou `null` tant qu'il n'en a pas saisi. Un `$state` initialisé
   * depuis la valeur connue ne verrait jamais celle-ci arriver : les cours se chargent APRÈS le
   * premier rendu, et le champ resterait vide.
   */
  let globalOverride = $state<string | null>(null);
  let announced = $state('');

  /**
   * On tape « 1 000,50 » en français. Même convention que les autres champs de montant du dépôt,
   * augmentée des espaces de milliers : `\s` couvre en JavaScript l'espace insécable et l'espace
   * insécable étroit, ceux-là mêmes qu'un copier-coller de montant formaté rapporte.
   */
  const parseInput = (raw: string): ReturnType<typeof parseDecimal> =>
    parseDecimal(raw.replace(/\s/g, '').replace(',', '.'));

  const proceeds = $derived(parseInput(proceedsRaw));
  const fees = $derived(parseInput(feesRaw));
  /**
   * La valeur connue, **arrondie au centime** : brute, elle s'affichait avec quatorze décimales.
   * Aucune précision utile n'est perdue — c'est une hypothèse que l'utilisateur peut corriger, et
   * qu'il ne saurait de toute façon pas saisir plus finement.
   */
  const knownRounded = $derived(
    knownGlobalValueEur === null ? null : toDecimalString(roundHalfUp(D(knownGlobalValueEur), 2)),
  );
  const globalRaw = $derived(globalOverride ?? knownRounded ?? '');
  const globalValue = $derived(parseInput(globalRaw));

  /** Au-delà de la valeur du portefeuille, l'hypothèse n'a plus de sens : on ne vend pas plus. */
  const tooBig = $derived(
    proceeds !== null && globalValue !== null && globalValue.gt(ZERO) && proceeds.gt(globalValue),
  );

  const forecast = $derived.by((): Forecast | null => {
    if (proceeds === null || globalValue === null || tooBig) return null;
    return forecastCession(input, {
      kind: 'crypto',
      proceedsEur: toDecimalString(proceeds),
      feesEur: fees === null ? '0' : toDecimalString(fees),
      globalValueEur: toDecimalString(globalValue),
    });
  });

  /**
   * Le coût total d'une année sous chaque voie. `null` quand la tranche du foyer manque encore.
   * Une année exonérée ou en perte n'a **pas** d'arbitrage : le zéro rendu alors est un vrai zéro,
   * pas un repli — ni impôt ni prélèvements sociaux ne sont dus.
   */
  const costs = (
    arbitrage: Forecast['before'],
  ): { flat: DecimalString; scale: DecimalString } | null => {
    if (arbitrage.bases.length === 0) return { flat: '0', scale: '0' };
    if (basis === null) return null;
    const choice = taxChoice(arbitrage, basis);
    return choice === null ? null : { flat: choice.flat.totalEur, scale: choice.scale.totalEur };
  };

  const before = $derived(forecast === null ? null : costs(forecast.before));
  const after = $derived(forecast === null ? null : costs(forecast.after));
  /** La tranche du foyer, une fois cette vente ajoutée. */
  const afterChoice = $derived.by((): TaxChoice | null => {
    if (forecast === null || basis === null || forecast.after.bases.length === 0) return null;
    return taxChoice(forecast.after, basis);
  });

  const eur = (amount: DecimalString): string => (discreet ? 'masqué' : fmtEur(amount));

  /**
   * La plus ou moins-value annoncée en tête, **telle que le tableau la montre** : la différence
   * des deux résultats d'année ARRONDIS, et non l'arrondi de la plus-value exacte. Les deux ne
   * coïncident pas toujours au centime — le verdict disait 330,18 € sous une colonne « Écart »
   * qui affichait −330,17 €. Même règle que `displayGap` (décision n° 150), et même raison : sur
   * un écran dont toute la valeur est que les chiffres se recoupent, un centime suffit.
   */
  const movedEur = $derived(
    forecast === null
      ? ZERO
      : (displayGap(D(forecast.preview.yearNetEur), D(forecast.beforeNetEur)) ?? ZERO),
  );
  /** Un écart **affiché** : chaque branche arrondie, puis soustraite (décision n° 150). */
  const gap = (from: DecimalString, to: DecimalString): string =>
    discreet ? 'masqué' : fmtEur(displayGap(D(to), D(from)) ?? ZERO, { sign: true });

  // L'annonce parlée, différée : le résultat visible, lui, suit la frappe sans attendre.
  $effect(() => {
    const f = forecast;
    const a = after;
    const moved = movedEur;
    const timer = setTimeout(() => {
      announced =
        f === null
          ? ''
          : `Cette vente dégagerait ${fmtEur(moved.abs())} de ${moved.lt(ZERO) ? 'moins' : 'plus'}-value. ` +
            (a === null
              ? 'Indiquez votre foyer pour voir l’impôt.'
              : `L’impôt de l’année passerait à ${fmtEur(a.flat)} au forfait.`);
    }, SPEAK_AFTER_MS);
    return () => clearTimeout(timer);
  });
</script>

<div class="forecast">
  <h3>Et si je vendais d’ici le 31 décembre ?</h3>

  <div class="fields">
    <label>
      Montant de la vente, net de frais
      <input
        inputmode="decimal"
        autocomplete="off"
        placeholder="0"
        bind:value={proceedsRaw}
        aria-describedby="forecast-note"
      />
    </label>
    <label>
      Frais attendus
      <input inputmode="decimal" autocomplete="off" placeholder="0" bind:value={feesRaw} />
    </label>
  </div>

  <label class="global">
    Valeur de votre portefeuille avant la vente
    <input
      inputmode="decimal"
      autocomplete="off"
      value={globalRaw}
      oninput={(event) => (globalOverride = event.currentTarget.value)}
    />
  </label>
  <p class="muted small">
    C’est le dénominateur de la formule, et la loi le prend au niveau du <strong
      >foyer fiscal</strong
    >, tous supports confondus — plateformes étrangères et stockage hors ligne compris. Cette
    application ne connaît que ce qu’on lui a importé :
    <strong>une valeur trop basse sous-estime l’impôt</strong>. Corrigez-la si vous détenez des
    crypto-actifs ailleurs.
  </p>

  {#if tooBig}
    <p class="note small" role="status">
      Ce montant dépasse la valeur de votre portefeuille. On ne cède pas plus que ce que l’on
      détient : la formule n’a pas de sens au-delà, et rien n’est chiffré.
    </p>
  {:else if forecast === null}
    <p class="muted small" id="forecast-note">
      Indiquez un montant pour voir ce que cette vente changerait. L’application n’en propose aucun.
    </p>
  {:else}
    <p class="verdict">
      Cette vente dégagerait <strong>{eur(toDecimalString(movedEur.abs()))}</strong>
      {movedEur.lt(ZERO) ? 'de moins-value' : 'de plus-value'}.
    </p>

    <table>
      <caption class="sr-only">L’année {forecast.year} avant et après cette vente</caption>
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col">Aujourd’hui</th>
          <th scope="col">Avec cette vente</th>
          <th scope="col">Écart</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Total des cessions</th>
          <td>{eur(forecast.beforeProceedsEur)}</td>
          <td>{eur(forecast.preview.yearProceedsEur)}</td>
          <td>{gap(forecast.beforeProceedsEur, forecast.preview.yearProceedsEur)}</td>
        </tr>
        <tr>
          <th scope="row">Résultat de l’année</th>
          <td>{eur(forecast.beforeNetEur)}</td>
          <td>{eur(forecast.preview.yearNetEur)}</td>
          <td>{gap(forecast.beforeNetEur, forecast.preview.yearNetEur)}</td>
        </tr>
        {#if before !== null && after !== null}
          <tr>
            <th scope="row">Au prélèvement forfaitaire</th>
            <td>{eur(before.flat)}</td>
            <td>{eur(after.flat)}</td>
            <td>{gap(before.flat, after.flat)}</td>
          </tr>
          <tr>
            <th scope="row">Au barème progressif</th>
            <td>{eur(before.scale)}</td>
            <td>{eur(after.scale)}</td>
            <td>{gap(before.scale, after.scale)}</td>
          </tr>
        {/if}
      </tbody>
    </table>

    {#if before === null || after === null}
      <p class="note small">
        Indiquez votre tranche ou votre revenu plus haut pour voir ce que cette vente coûterait sous
        chacune des deux voies.
      </p>
    {/if}

    <ul class="small">
      {#if forecast.crossesThreshold}
        <li>
          <strong>C’est cette vente qui ferait franchir le seuil de 305 €.</strong> L’année entière devient
          alors imposable — les cessions déjà faites comprises, y compris celles dont le prix n’atteignait
          pas le seuil. Ce n’est pas un abattement.
        </li>
      {/if}
      {#if D(forecast.pocketUsedEur).gt(ZERO)}
        <li>
          Cette vente consommerait <strong>{eur(forecast.pocketUsedEur)}</strong> de votre
          moins-value imputable ; il en resterait {eur(forecast.pocketLeftEur)} jusqu’au 31 décembre
          {forecast.year}.
        </li>
      {:else if D(forecast.pocketLeftEur).gt(ZERO)}
        <li>
          La moins-value imputable passerait à <strong>{eur(forecast.pocketLeftEur)}</strong>. Elle
          ne s’impute que sur des plus-values de la <em>même</em> année, et s’éteint au 31 décembre
          {forecast.year}.
        </li>
      {/if}
      {#if afterChoice?.crossesBracket}
        <li>
          <strong>Cette vente vous ferait changer de tranche</strong> : de
          {fmtRate(afterChoice.marginalRateBefore)} à {fmtRate(afterChoice.marginalRateAfter)}. Une
          partie serait taxée au premier taux, le reste au second.
        </li>
      {/if}
      {#if forecast.preview.exempt}
        <li>
          Sous le seuil, l’année reste exonérée — mais pas dispensée : les <em>prix</em> de chaque cession
          restent à déclarer.
        </li>
      {/if}
    </ul>
  {/if}

  <p class="muted small">
    Ce chiffrage ne dépend que des montants que vous indiquez. Il ne constitue ni une déclaration,
    ni un conseil.
  </p>
  <p class="sr-only" role="status">{announced}</p>
</div>

<style>
  .forecast {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-sm);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  label {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  input {
    min-width: 8rem;
  }
  .global input {
    max-width: 12rem;
  }
  .verdict {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
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
  ul {
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
    background: var(--bg);
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
