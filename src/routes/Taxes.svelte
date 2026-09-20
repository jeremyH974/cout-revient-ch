<script lang="ts">
  /**
   * L'écran « Impôts » : les deux voies d'imposition, côte à côte (décision n° 170).
   *
   * La Déclaration dit **ce qu'il faut reporter**. Cet écran dit **ce que ça coûte**, et pourquoi —
   * pour l'année close comme pour l'année EN COURS, dont rien n'est encore joué.
   *
   * Il n'arbitre rien et ne recommande rien : tout le calcul vit dans `$lib/derive/tax-choice.ts`,
   * `pfu-vs-bareme.ts` et `tax-outlook.ts`. Ici, on affiche.
   *
   * **Montants en euros, toujours**, quelle que soit la devise d'affichage : on ne remplit pas une
   * déclaration française en francs suisses. Le rappel est à l'écran, pas seulement ici.
   *
   * **Mode discret** : les montants calculés se masquent comme ailleurs, et le revenu du foyer —
   * la donnée la plus personnelle de cette application — ne s'affiche qu'à la demande.
   */
  import { onMount } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { arbitrages, type Arbitrage } from '$lib/derive/pfu-vs-bareme';
  import { marginalRateFor, scaleForYearOrLatest } from '$lib/derive/household-tax';
  import { taxChoice, type TaxBasis, type TaxChoice, type TaxSide } from '$lib/derive/tax-choice';
  import { yearOutlook, yearStatus } from '$lib/derive/tax-outlook';
  import { computeDeclarations } from '$lib/domain/declarations-fr';
  import { MARGINAL_RATES } from '$lib/domain/income-tax-fr';
  import { D, ZERO, parseDecimal, toDecimalString, type DecimalString } from '$lib/domain/money';
  import { declarableYears, declarationYear } from '$lib/domain/tax-fr';
  import { displayGap, fmtEur, fmtEurWhole, fmtRate, roundHalfUp } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import ArbitrageCaveats from '../components/tax/ArbitrageCaveats.svelte';
  import SaleForecast from '../components/tax/SaleForecast.svelte';
  import CostBar from '../components/tax/CostBar.svelte';
  import TaxYearPicker from '../components/tax/TaxYearPicker.svelte';
  import { app } from '../state/app.svelte';
  import { history } from '../state/history.svelte';

  // Sans historique de cours, l'article 150 VH bis n'a pas de valeur globale de portefeuille :
  // la partie crypto manquerait sans qu'on sache pourquoi.
  onMount(() => void history.ensure());

  const PARTS = ['1', '1.25', '1.5', '1.75', '2', '2.25', '2.5', '3', '3.5', '4', '4.5', '5'];

  const today = $derived(nowIso().slice(0, 10));
  let taxYear = $state(declarationYear(nowIso().slice(0, 10)));
  let incomeRaw = $state(app.state.ui.householdIncomeEur ?? '');
  let editingIncome = $state(false);

  const ui = $derived(app.state.ui);
  const discreet = $derived(ui.discreet);
  const cryptoReady = $derived(history.status.loadedAt !== null);
  const yearChoices = $derived(declarableYears(app.events, today));

  const returnInput = $derived({
    year: taxYear,
    crypto: cryptoReady ? history.frenchTax() : null,
    equity: app.equityTax,
    dividends: app.dividendTax,
    interest: app.interestTax,
    lending: app.lendingTax,
    declarations: computeDeclarations({
      accounts: app.accounts,
      events: app.events,
      year: taxYear,
    }),
  });

  const options = $derived(arbitrages(returnInput));
  /**
   * L'état de l'année sert encore, mais plus à la PHRASE du sélecteur — `TaxYearPicker` la rend
   * désormais lui-même (décision n° 172). Il ne reste ici que ce qu'aucun vocabulaire partagé ne
   * peut porter : le prévisionnel de vente ne s'affiche que sur une année en cours.
   */
  const status = $derived(yearStatus(taxYear, today));

  /**
   * La valeur du portefeuille que l'application connaît, en euros — le dénominateur de la formule
   * de l'article 150 VH bis. Le rapport est dans la devise d'affichage ; la fiscalité française ne
   * connaît que l'euro, d'où la conversion.
   */
  const knownGlobalValueEur = $derived.by((): DecimalString | null => {
    const value = app.eurFromDisplay(app.report.totals.value);
    return value === null ? null : toDecimalString(value);
  });
  const outlook = $derived(cryptoReady ? yearOutlook(history.frenchTax(), taxYear, today) : null);
  const scaleChoice = $derived(scaleForYearOrLatest(taxYear));

  /** Le revenu saisi, quand il est lisible ; `null` tant qu'il ne l'est pas. */
  const income = $derived(
    ui.householdIncomeEur === null ? null : parseDecimal(ui.householdIncomeEur),
  );
  const parts = $derived(ui.householdParts === null ? null : parseDecimal(ui.householdParts));

  /**
   * L'hypothèse de foyer, dans le mode choisi — `null` tant qu'elle manque. L'application ne la
   * devine jamais : c'est l'utilisateur qui la fournit, et l'écran le dit à chaque chiffre.
   */
  const basis = $derived.by((): TaxBasis | null => {
    if (ui.taxBasis === 'household') {
      if (income === null || parts === null || !parts.gt(ZERO)) return null;
      return {
        kind: 'household',
        household: { taxableIncomeEur: toDecimalString(income), parts: toDecimalString(parts) },
      };
    }
    return ui.marginalRate === null ? null : { kind: 'bracket', rate: ui.marginalRate };
  });

  /** La tranche déduite du revenu saisi, pour que la saisie se relise tout de suite. */
  const deducedRate = $derived(
    scaleChoice === null || income === null || parts === null || !parts.gt(ZERO)
      ? null
      : marginalRateFor(scaleChoice.scale, income, parts),
  );

  const choices = $derived(
    options.map((arb) => ({ arb, choice: basis === null ? null : taxChoice(arb, basis) })),
  );

  const OPTION_TITLES: Record<Arbitrage['option'], string> = {
    '3CN': 'Vos plus-values de crypto-actifs',
    '2OP': 'Vos revenus de capitaux mobiliers',
  };

  /**
   * L'assiette **telle qu'elle s'affiche** : somme des lignes arrondies, jamais l'arrondi de la
   * somme. Sur un écran dont toute la valeur est que les chiffres se recoupent, un centime suffit
   * à tout perdre (décision n° 150).
   */
  const displayedBase = (arb: Arbitrage): string =>
    fmtEur(arb.bases.reduce((acc, b) => acc.plus(roundHalfUp(D(b.taxableEur), 2)), ZERO));

  /** Les bornes d'une tranche, pour qu'on se reconnaisse sans aller les chercher ailleurs. */
  const bracketLabel = (rate: DecimalString): string => {
    const brackets = scaleChoice?.scale.brackets ?? [];
    const index = brackets.findIndex((b) => b.rate === rate);
    if (index === -1) return '';
    const from = index === 0 ? null : brackets[index - 1]?.upToEur;
    const to = brackets[index]?.upToEur;
    if (to === null || to === undefined) return `au-delà de ${fmtEurWhole(from ?? '0')}`;
    if (from === null || from === undefined) return `jusqu’à ${fmtEurWhole(to)}`;
    return `de ${fmtEurWhole(from)} à ${fmtEurWhole(to)}`;
  };

  /** Un montant, ou « masqué » : même règle que la Déclaration. */
  const eur = (amount: DecimalString): string => (discreet ? 'masqué' : fmtEur(amount));

  /**
   * Le total d'une colonne **tel qu'il doit s'afficher** : la somme des deux lignes ARRONDIES, et
   * non l'arrondi de la somme exacte. Sans cela, 106,96 € et 155,43 € s'annoncent sous un total de
   * 262,38 € qui ne s'additionne pas sous les yeux du lecteur (décision n° 150). L'arrondi reste
   * ici, dans l'affichage : `TaxSide.totalEur` demeure exact.
   */
  const displayedTotal = (voie: TaxSide): string =>
    eur(
      toDecimalString(
        roundHalfUp(D(voie.incomeTaxEur), 2).plus(roundHalfUp(D(voie.socialTaxEur), 2)),
      ),
    );

  /**
   * L'écart d'une tranche **tel qu'il doit s'afficher** : chaque branche arrondie, PUIS soustraite
   * — la règle de `displayGap`. Sans elle, la ligne « la vôtre » du tableau annonçait +5,12 €
   * là où le verdict, juste au-dessus, disait 5,13 € : un centime suffit à faire douter de tout
   * l'écran (décision n° 150).
   */
  const displayedDelta = (choice: TaxChoice, baremeEur: DecimalString): string =>
    discreet
      ? 'masqué'
      : fmtEur(displayGap(D(baremeEur), D(choice.flat.incomeTaxEur)) ?? ZERO, { sign: true });

  /** Pour 100 € d'assiette — un taux exprimé en euros, donc lisible sans calcul mental. */
  const per100 = (rate: DecimalString): string => fmtEur(D(rate).times(D('100')).toFixed(2));

  const setIncome = (raw: string): void => {
    incomeRaw = raw;
    const parsed = parseDecimal(raw.trim());
    app.setUi({ householdIncomeEur: parsed === null ? null : toDecimalString(parsed) });
  };

  /** Le constat, jamais un conseil : laquelle coûte le moins sur ce que l'application connaît. */
  const cheaperLabel = (choice: TaxChoice): string =>
    choice.cheaper === 'equal'
      ? 'Les deux coûtent la même chose.'
      : choice.cheaper === 'scale'
        ? `Le barème coûte ${fmtEur(choice.gapEur)} de moins.`
        : `Le barème coûte ${fmtEur(choice.gapEur)} de plus.`;

  const frDate = (iso: string): string => iso.split('-').reverse().join('/');
</script>

<AppBar title="Impôts" />

<section class="card intro">
  <h1>Forfait ou barème</h1>
  <p class="muted">
    Ce que vos gains coûtent selon la voie d’imposition, et à partir de quelle tranche la réponse
    change. C’est un <strong>chiffrage à une hypothèse que vous donnez</strong> : ni une déclaration,
    ni un conseil fiscal.
  </p>
  <div class="controls">
    <TaxYearPicker bind:value={taxYear} years={yearChoices} {today} />
  </div>
  <p class="muted small">
    Tous les montants sont en <strong>euros</strong>, quelle que soit la devise d’affichage.
  </p>
</section>

<section class="card household">
  <h2>Votre foyer</h2>
  <fieldset class="modes">
    <legend>Comment le décrire</legend>
    <label>
      <input
        type="radio"
        name="basis"
        value="bracket"
        checked={ui.taxBasis === 'bracket'}
        onchange={() => app.setUi({ taxBasis: 'bracket' })}
      />
      Je connais ma tranche
    </label>
    <label>
      <input
        type="radio"
        name="basis"
        value="household"
        checked={ui.taxBasis === 'household'}
        onchange={() => app.setUi({ taxBasis: 'household' })}
      />
      Je saisis mon revenu
    </label>
  </fieldset>

  {#if ui.taxBasis === 'bracket'}
    <fieldset class="chips">
      <legend>Votre tranche d’imposition</legend>
      {#each MARGINAL_RATES as rate (rate)}
        <label class="chip" class:on={ui.marginalRate === rate}>
          <input
            type="radio"
            name="rate"
            value={rate}
            checked={ui.marginalRate === rate}
            onchange={() => app.setUi({ marginalRate: rate })}
          />
          <span>{fmtRate(rate)}</span>
        </label>
      {/each}
    </fieldset>
    {#if ui.marginalRate !== null && bracketLabel(ui.marginalRate) !== ''}
      <p class="muted small">
        Revenu par part {bracketLabel(ui.marginalRate)}{#if scaleChoice?.isFallback}, selon le
          barème {scaleChoice.scale.year} — celui de {taxYear} n’est pas publié{/if}.
      </p>
    {/if}
    <p class="note small">
      Ce mode <strong>ne peut pas voir</strong> un changement de tranche : si vos gains vous font franchir
      une borne, l’écart affiché sera faux. Saisir votre revenu le corrige.
    </p>
  {:else}
    <div class="fields">
      {#if discreet && !editingIncome}
        <p class="masked">
          Revenu imposable : <span class="muted">masqué</span>
          <button type="button" class="link" onclick={() => (editingIncome = true)}>Modifier</button
          >
        </p>
      {:else}
        <label>
          Revenu imposable du foyer, hors ces gains
          <input
            inputmode="decimal"
            autocomplete="off"
            placeholder="45000"
            value={incomeRaw}
            oninput={(event) => setIncome(event.currentTarget.value)}
          />
        </label>
      {/if}
      <label>
        Parts
        <select
          value={ui.householdParts ?? ''}
          onchange={(event) =>
            app.setUi({
              householdParts: event.currentTarget.value === '' ? null : event.currentTarget.value,
            })}
        >
          <option value="">—</option>
          {#each PARTS as part (part)}
            <option value={part}>{part.replace('.', ',')}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if deducedRate !== null}
      <p class="muted small" role="status">
        Votre tranche : <strong>{fmtRate(deducedRate)}</strong> — revenu par part
        {bracketLabel(deducedRate)}{#if scaleChoice?.isFallback}, selon le barème
          {scaleChoice.scale.year} — celui de {taxYear} n’est pas publié{/if}.
      </p>
    {:else}
      <p class="muted small">Renseignez le revenu et les parts pour que le barème s’applique.</p>
    {/if}
    <p class="note small">
      Ce revenu ne quitte pas cet appareil. Il sert au seul calcul ci-dessous.
    </p>
  {/if}
</section>

{#if !cryptoReady}
  <p class="card note" role="status">
    {#if history.status.loading}
      Les plus-values de crypto-actifs manquent encore : leur calcul attend l’historique des cours.
    {:else}
      L’historique des cours n’a pas pu être chargé : sans lui, l’article 150 VH bis n’a pas de
      valeur globale de portefeuille. <strong>La partie crypto manque donc à cet écran.</strong>
    {/if}
  </p>
{/if}

{#each choices as { arb, choice } (arb.option)}
  <section class="card option">
    <h2>{OPTION_TITLES[arb.option]}</h2>
    <p class="muted small">
      {displayedBase(arb)} d’assiette, case {arb.option}. Les prélèvements sociaux sont dus
      <strong>à l’identique</strong> dans les deux cas : ils ne s’arbitrent pas.
    </p>

    {#if choice === null}
      <p class="note small">
        Indiquez votre tranche ou votre revenu ci-dessus pour voir ce que chaque voie coûte.
      </p>
    {:else}
      <div class="duel">
        {#each [choice.flat, choice.scale] as voie (voie.key)}
          <article class="side" class:cheapest={choice.cheaper === voie.key}>
            <h3>{voie.label}</h3>
            <p class="total">{displayedTotal(voie)}</p>
            <CostBar
              incomeTaxEur={voie.incomeTaxEur}
              socialTaxEur={voie.socialTaxEur}
              scaleMaxEur={D(choice.flat.totalEur).gte(D(choice.scale.totalEur))
                ? choice.flat.totalEur
                : choice.scale.totalEur}
            />
            <dl class="split">
              <dt>Impôt sur le revenu</dt>
              <dd>{eur(voie.incomeTaxEur)}</dd>
              <dt>Prélèvements sociaux</dt>
              <dd>{eur(voie.socialTaxEur)}</dd>
            </dl>
            {#if choice.cheaper === voie.key}
              <p class="badge">Le moins cher ici</p>
            {/if}
          </article>
        {/each}
      </div>

      <p class="gap">{discreet ? 'Écart masqué.' : cheaperLabel(choice)}</p>
      <p class="muted small">
        Pour 100 € d’assiette, le forfait prend
        <strong>{per100(choice.flatRateOnBase)}</strong> et le barème
        <strong>{per100(choice.scaleRateOnBase)}</strong> — CSG déductible déduite.
      </p>

      <details class="ladder">
        <summary>Où ça bascule</summary>
        <table>
          <caption class="sr-only">
            Coût du barème et écart avec le forfait, tranche par tranche
          </caption>
          <thead>
            <tr>
              <th scope="col">Tranche</th>
              <th scope="col">Barème</th>
              <th scope="col">Écart</th>
            </tr>
          </thead>
          <tbody>
            {#each choice.ladder as step (step.rate)}
              <tr class:yours={step.isYours}>
                <th scope="row">
                  {fmtRate(step.rate)}
                  {#if step.isYours}<span class="tag">la vôtre</span>{/if}
                  {#if step.isBreakEven}<span class="tag">bascule</span>{/if}
                </th>
                <td>{eur(step.baremeEur)}</td>
                <td>{displayedDelta(choice, step.baremeEur)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="small">
          <strong
            >Le barème coûte moins jusqu’à la tranche à {fmtRate(arb.breakEvenRate ?? '0')}
            incluse</strong
          > ; à partir de la suivante, le forfait l’emporte.
        </p>
      </details>

      <details class="explainer">
        <summary
          >Une tranche à {fmtRate(choice.marginalRateBefore)}, est-ce le taux de tout ?</summary
        >
        <p class="small">
          Non. Votre tranche est le taux qui frappe vos <strong>derniers</strong> euros, pas la
          moyenne de votre impôt : les premiers euros de revenu restent taxés à 0 %, les suivants à
          11 %, et ainsi de suite. C’est pourquoi le barème, ci-dessus, ne prend pas
          {fmtRate(choice.marginalRateBefore)} de l’assiette.
        </p>
        {#if choice.crossesBracket}
          <p class="small warn-text">
            <strong
              >Ces revenus vous font changer de tranche : de {fmtRate(choice.marginalRateBefore)} à
              {fmtRate(choice.marginalRateAfter)}.</strong
            > Une partie est donc taxée au premier taux et le reste au second — un calcul qu’une tranche
            choisie à la main ne peut pas faire.
          </p>
        {/if}
        {#if choice.basis === 'bracket'}
          <p class="small">
            Ce chiffrage suppose que votre tranche <em>reste</em> celle que vous avez indiquée.
          </p>
        {/if}
        {#if choice.scaleIsFallback}
          <p class="small">
            Le barème {choice.year} n’est pas publié : celui de {choice.scaleYear} a été appliqué.
          </p>
        {/if}
      </details>

      <ul class="caveats small">
        <ArbitrageCaveats arbitrage={arb} mode={choice.basis} {discreet} />
      </ul>
    {/if}
  </section>
{/each}

{#if outlook !== null && (outlook.state === 'in-progress' || D(outlook.offsetPocketEur).gt(ZERO))}
  <section class="card outlook">
    <h2>Ce qui reste ouvert en {outlook.year}</h2>
    <ul class="small">
      <li>
        {#if D(outlook.toThresholdEur).gt(ZERO)}
          <strong>Seuil de {fmtEurWhole(outlook.thresholdEur)} :</strong> il reste
          {eur(outlook.toThresholdEur)} de prix de cession avant de le franchir. En deçà, l’année entière
          est exonérée ; au-delà, l’exonération tombe d’un coup — ce n’est pas un abattement.
        {:else}
          <strong>Seuil de {fmtEurWhole(outlook.thresholdEur)} :</strong> franchi. L’exonération de l’article
          150 VH bis ne s’applique plus à cette année.
        {/if}
      </li>
      {#if D(outlook.offsetPocketEur).gt(ZERO)}
        <li>
          <strong>Moins-value imputable : {eur(outlook.offsetPocketEur)}.</strong> Elle s’impute sur
          les plus-values de même nature de la <em>même</em> année, et sur elles seules. Ce qui n’a
          pas servi au {frDate(outlook.pocketExpiresOn)} est éteint : rien ne se reporte sur
          {outlook.year + 1}.
        </li>
      {/if}
      {#if outlook.taxYear !== null && outlook.taxYear.unknownGlobalValue > 0}
        <li>
          {outlook.taxYear.unknownGlobalValue} cession(s) sans valeur globale de portefeuille connue :
          l’année reste approximative.
        </li>
      {/if}
    </ul>

    <!-- Le prévisionnel n'a de sens que sur l'année en cours : une année close ne se simule pas. -->
    {#if status.state === 'in-progress'}
      <SaleForecast input={returnInput} {basis} {knownGlobalValueEur} {discreet} />
    {/if}
  </section>
{/if}

{#if options.length === 0 && cryptoReady}
  <section class="card empty">
    <p>
      Rien à arbitrer au titre de {taxYear} : sans plus-value nette imposable, les deux voies coûtent
      la même chose — zéro.
    </p>
    <p class="muted small">
      Cela ne vaut pas dispense de déclarer : les cessions se déclarent même sans gain.
      <a href={router.href({ name: 'declaration' })}>Voir ce qu’il faut reporter</a>.
    </p>
  </section>
{:else}
  <p class="card muted small">
    Les cases et les montants à recopier sont sur <a href={router.href({ name: 'declaration' })}
      >l’écran Déclaration</a
    >.
  </p>
{/if}

<style>
  h1 {
    margin: 0;
    font-size: var(--fs-lg);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  h3 {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  section.card {
    display: grid;
    gap: var(--space-3);
  }
  .controls {
    display: grid;
    gap: var(--space-2);
  }
  .modes,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .modes label {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    min-height: var(--tap);
    font-size: var(--fs-sm);
  }
  .chip {
    display: flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--bg-sunken);
    font-weight: 600;
  }
  .chip input {
    margin-right: var(--space-2);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .fields label {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  .fields input {
    min-width: 8rem;
  }
  .masked {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: 0;
    font-size: var(--fs-sm);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .duel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-3);
  }
  .side {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .side.cheapest {
    border-color: var(--accent);
  }
  .total {
    margin: 0;
    font-size: var(--fs-xl);
    font-variant-numeric: tabular-nums;
  }
  .split {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    font-size: var(--fs-sm);
  }
  .split dt {
    color: var(--fg-muted);
  }
  .split dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .badge {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--accent);
  }
  .gap {
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
  tr.yours {
    background: var(--bg-sunken);
  }
  .tag {
    display: inline-block;
    margin-left: var(--space-1);
    padding: 0 var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    font-weight: 400;
    color: var(--fg-muted);
  }
  /* Pas de `display: flex` ici : il efface le triangle de repli, et le volet passe alors pour
     un titre mort. La hauteur de frappe vient du remplissage. */
  summary {
    min-height: var(--tap);
    padding: var(--space-2) 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
  }
  details {
    display: grid;
    gap: var(--space-2);
  }
  .caveats,
  .outlook ul {
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
  .warn-text {
    color: var(--warn);
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
