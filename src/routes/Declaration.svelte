<script lang="ts">
  /**
   * Le récapitulatif de déclaration, case par case (décision n° 149, P107).
   *
   * Les cinq moteurs fiscaux vivaient sur trois écrans qui ne se croisaient pas. Celui-ci les
   * réunit pour **une** année, dans l'ordre du parcours en ligne, et ne montre que ce qui concerne
   * réellement l'utilisateur. Le calcul est ailleurs (`$lib/derive/tax-return.ts`) : cet écran
   * n'arbitre rien, il affiche.
   *
   * **Les montants sont en euros, toujours.** Les autres écrans fiscaux les convertissent dans la
   * devise d'affichage ; ici ce serait un faux : on ne remplit pas une déclaration française en
   * francs suisses. Le rappel est écrit à l'écran, pas seulement ici.
   */
  import { onMount } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { computeDeclarations } from '$lib/domain/declarations-fr';
  import { declarableYears, declarationYear } from '$lib/domain/tax-fr';
  import { D, ZERO, type Big } from '$lib/domain/money';
  import { FAMILY_LABELS, taxReturn, type TaxReturnLine } from '$lib/derive/tax-return';
  import { arbitrages, type Arbitrage, type ArbitrageScenario } from '$lib/derive/pfu-vs-bareme';
  import { MARGINAL_RATES, scaleFor } from '$lib/domain/income-tax-fr';
  import { displayGap, fmtEur, fmtEurWhole, fmtRate, roundHalfUp } from '$lib/format/fr';
  import type { TaxEntryMode } from '$lib/domain/tax-boxes';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
  import { history } from '../state/history.svelte';
  import { toasts } from '../state/ui.svelte';

  // Sans historique de prix, l'article 150 VH bis n'a pas de valeur globale de portefeuille : la
  // partie crypto resterait absente sans qu'on sache pourquoi.
  onMount(() => void history.ensure());

  let taxYear = $state(declarationYear(nowIso().slice(0, 10)));
  let copied = $state<string | null>(null);

  const yearChoices = $derived(declarableYears(app.events, nowIso().slice(0, 10)));
  const cryptoReady = $derived(history.status.loadedAt !== null);

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
  const report = $derived(taxReturn(returnInput));

  /**
   * L'arbitrage forfait / barème des deux options (décision n° 150). Il ne dit pas quoi cocher :
   * il chiffre un écart à une hypothèse que l'utilisateur fournit, et nomme le seuil de bascule.
   */
  const options = $derived(arbitrages(returnInput));
  /** Tranche saisie par l'utilisateur, ou `null` : l'application ne la devine pas. */
  const marginalRate = $derived(app.state.ui.marginalRate);
  const scale = $derived(scaleFor(taxYear));
  const scenarioAt = (arbitrage: Arbitrage, rate: string): ArbitrageScenario | undefined =>
    arbitrage.scenarios.find((s) => s.rate === rate);

  /**
   * L'assiette totale **telle qu'elle doit s'afficher** : la somme des lignes ARRONDIES, et non
   * l'arrondi de la somme exacte. Sans cela, deux montants justes (1,36 € et 32,42 €) s'annoncent
   * sous un total de 33,79 € qui ne s'additionne pas sous les yeux du lecteur — même famille que
   * `displayGap` (décision n° 150). Sur un écran dont toute la valeur est que les chiffres se
   * recoupent, un centime suffit à tout perdre.
   */
  const displayedBase = (arbitrage: Arbitrage): Big =>
    arbitrage.bases.reduce((acc, b) => acc.plus(roundHalfUp(D(b.taxableEur), 2)), ZERO);

  /** Même règle pour l'écart : arrondir chaque branche, puis soustraire. */
  const displayedDelta = (arbitrage: Arbitrage, scenario: ArbitrageScenario): Big =>
    displayGap(D(scenario.baremeEur), D(arbitrage.flatEur)) ?? ZERO;

  /**
   * Les bornes de la tranche, quand le barème de l'année est connu. Sans elles, le taux seul
   * obligerait à aller chercher ailleurs à quelle tranche on appartient ; avec des bornes d'une
   * AUTRE année, il ferait reconnaître la mauvaise (décision n° 150).
   */
  const bracketLabel = $derived((rate: string): string => {
    const brackets = scale?.brackets ?? [];
    const index = brackets.findIndex((b) => b.rate === rate);
    if (index === -1) return '';
    const from = index === 0 ? null : brackets[index - 1]?.upToEur;
    const to = brackets[index]?.upToEur;
    if (to === null || to === undefined) return ` — au-delà de ${fmtEurWhole(from ?? '0')}`;
    if (from === null || from === undefined) return ` — jusqu’à ${fmtEurWhole(to)}`;
    return ` — de ${fmtEurWhole(from)} à ${fmtEurWhole(to)}`;
  });

  /** Conventions de calcul des moteurs concernés : reproduites, jamais résumées. */
  const assumptions = $derived.by((): [string, readonly string[]][] => {
    const all: [string, readonly string[]][] = [
      ['Titres', report.families.includes('equity') ? app.equityTax.assumptions : []],
      ['Dividendes', report.families.includes('dividend') ? app.dividendTax.assumptions : []],
      [
        'Intérêts de trésorerie',
        report.families.includes('interest') ? app.interestTax.assumptions : [],
      ],
      [
        'Prêts participatifs',
        report.families.includes('lending') ? app.lendingTax.assumptions : [],
      ],
    ];
    return all.filter(([, list]) => list.length > 0);
  });

  const ENTRY_LABELS: Record<TaxEntryMode, string> = {
    typed: 'à saisir',
    carried: 'reporté depuis l’annexe',
    prefilled: 'souvent pré-rempli',
  };

  const kindLabel = (line: TaxReturnLine): string =>
    line.box.kind === 'form'
      ? 'Formulaire à ouvrir'
      : line.box.kind === 'checkbox'
        ? 'Case à cocher'
        : 'Case à montant';

  /** Ce qui part au presse-papiers : le nombre nu, tel qu'il s'affiche, sans symbole ni espace. */
  const copyText = (value: string): string => roundHalfUp(D(value), 2).toFixed(2).replace('.', ',');

  async function copy(code: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(copyText(value));
      copied = code;
    } catch {
      toasts.push(`Copie impossible : recopiez ${copyText(value)} à la main.`, 'error');
    }
  }
</script>

<AppBar title="Déclaration" />

<section class="card intro">
  <h1>Ce qu’il faut reporter</h1>
  <p class="muted">
    Les cases de votre déclaration de revenus, dans l’ordre du parcours en ligne, avec le montant
    que cette application calcule pour chacune. C’est une <strong>aide au report</strong> : ni une déclaration,
    ni un conseil fiscal.
  </p>
  <div class="controls">
    <label class="year">
      Année déclarée
      <select bind:value={taxYear}>
        {#each yearChoices as year (year)}
          <option value={year}>{year}</option>
        {/each}
      </select>
    </label>
    {#if options.length > 0}
      <label class="year">
        Votre tranche d’imposition
        <select
          value={marginalRate ?? ''}
          onchange={(event) =>
            app.setUi({
              marginalRate: event.currentTarget.value === '' ? null : event.currentTarget.value,
            })}
        >
          <option value="">— non renseignée —</option>
          {#each MARGINAL_RATES as rate (rate)}
            <option value={rate}>{fmtRate(rate)}{bracketLabel(rate)}</option>
          {/each}
        </select>
      </label>
    {/if}
    <p class="muted small">
      Tous les montants sont en <strong>euros</strong>, quelle que soit la devise d’affichage.
    </p>
  </div>
</section>

{#if !cryptoReady}
  <p class="card note" role="status">
    {#if history.status.loading}
      Les cessions de crypto-actifs manquent encore à cette liste : leur calcul attend l’historique
      des cours, en cours de chargement.
    {:else}
      <!-- Ne jamais laisser un « ça arrive » qui n'arrive pas : hors ligne, le chargement échoue
           en silence, et l'écran doit nommer les cases absentes plutôt que faire patienter. -->
      L’historique des cours n’a pas pu être chargé : sans lui, l’article 150 VH bis n’a pas de valeur
      globale de portefeuille.
      <strong>Les cases 2086, 3AN, 3BN et 3CN manquent donc à cette liste</strong> — elle n’est pas complète
      tant que cette ligne est là.
    {/if}
  </p>
{/if}

{#if report.lines.length === 0}
  <section class="card empty">
    <p>Rien à reporter au titre de {taxYear} d’après ce que cette application connaît.</p>
    <p class="muted small">
      Cela ne vaut pas dispense : une opération non importée reste à déclarer. Vérifiez l’année
      choisie, puis vos <a href={router.href({ name: 'accounts' })}>comptes</a> et vos
      <a href={router.href({ name: 'import' })}>imports</a>.
    </p>
  </section>
{:else}
  <ol class="lines">
    {#each report.lines as line (line.box.code)}
      <li class="card line">
        <div class="head">
          <span class="code"
            >{line.box.code}{#if line.box.throughCode}<span class="muted"
                >→{line.box.throughCode}</span
              >{/if}</span
          >
          <span class="badge kind">{kindLabel(line)}</span>
          <span class="badge entry">{ENTRY_LABELS[line.box.entry]}</span>
          <span class="form muted">{line.box.form}</span>
        </div>
        <p class="label">{line.box.label}</p>

        {#if line.amounts.length > 0}
          <ul class="amounts">
            {#each line.amounts as value (value.code)}
              <li>
                <span class="amount-code">{value.code}</span>
                {#if app.state.ui.discreet}
                  <span class="amount muted">masqué</span>
                {:else}
                  <span class="amount">{fmtEur(value.amountEur)}</span>
                  <button
                    type="button"
                    class="copy"
                    onclick={() => void copy(value.code, value.amountEur)}
                    >{copied === value.code ? 'Copié' : 'Copier'}<span class="sr-only">
                      le montant de la case {value.code}</span
                    ></button
                  >
                {/if}
                <span class="terms muted small">
                  {#each value.terms as t, i (t.label)}{i > 0 ? ' · ' : ''}{t.label}
                    {fmtEur(t.amountEur, { sign: true })}{/each}
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#each options.filter((a) => a.option === line.box.code) as arb (arb.option)}
          {@const chosen = marginalRate === null ? undefined : scenarioAt(arb, marginalRate)}
          <div class="arbitrage">
            <h3>Forfait ou barème, sur ce que cette application connaît</h3>
            <p class="summary small">
              Le prélèvement forfaitaire coûte <strong>{fmtEur(arb.flatEur)}</strong> d’impôt sur le
              revenu sur {fmtEur(displayedBase(arb))} d’assiette. Les prélèvements sociaux sont dus à
              l’identique dans les deux cas : ils ne s’arbitrent pas.
            </p>
            <ul class="bases small">
              {#each arb.bases as base (base.family)}
                <li>
                  {base.label} — {fmtEur(base.taxableEur)}{#if base.abatement !== '0'}, dont
                    {fmtRate(base.abatement)} d’abattement sous le barème{/if}
                </li>
              {/each}
            </ul>

            {#if chosen}
              <p class="verdict">
                À la tranche que vous avez indiquée ({fmtRate(marginalRate ?? '0')}), le barème
                coûterait <strong>{fmtEur(chosen.baremeEur)}</strong> — soit
                <strong>{fmtEur(displayedDelta(arb, chosen), { sign: true })}</strong>
                {displayedDelta(arb, chosen).lte(ZERO) ? 'en votre faveur' : 'de plus'}.
              </p>
            {:else}
              <p class="note small">
                Indiquez votre tranche d’imposition en haut de l’écran pour voir l’écart en euros.
              </p>
            {/if}

            <p class="small">
              <strong
                >Le barème coûte moins jusqu’à la tranche à {fmtRate(arb.breakEvenRate ?? '0')}
                incluse</strong
              > ; à partir de la suivante, le forfait l’emporte.
            </p>

            <ul class="caveats small">
              {#if arb.option === '2OP'}
                <li>
                  <strong>Cette option est globale.</strong> Elle bascule d’un coup toutes les lignes
                  ci-dessus, pour tout le foyer et pour l’année entière — on ne peut pas la réserver aux
                  dividendes, dont l’abattement la rend attrayante, en laissant les intérêts au forfait.
                </li>
              {/if}
              <li>
                Ce total ne compte que les revenus que cette application connaît. Un autre revenu de
                capitaux mobiliers, ailleurs, déplacerait l’écart.
              </li>
              <li>
                L’écart suppose que votre tranche <em>reste</em> celle indiquée. Ajouter ces revenus à
                votre revenu global peut vous en faire changer, et l’application ne connaît ni ce revenu
                global ni votre quotient familial.
              </li>
              <li>
                La CSG déductible retenue ici ({fmtEur(arb.csgDeductibleEur)}) réduit le revenu
                <em>de l’année où elle est payée</em> : pour un revenu recouvré par avis, le gain arrive
                sur la déclaration suivante.
              </li>
              {#if arb.bases.some((b) => b.family === 'equity')}
                <li>
                  Aucun abattement pour durée de détention n’est appliqué. Si vous détenez des
                  titres acquis <strong>avant 2018</strong>, le barème peut rester avantageux bien
                  au-delà de cette tranche — ce cas sort de ce que l’application sait calculer.
                </li>
              {/if}
              <li>
                L’option modifie aussi votre revenu fiscal de référence, dont dépendent d’autres
                droits. Ce chiffrage ne le regarde pas.
              </li>
              <li>
                {#if arb.revocable}
                  Depuis la loi de finances pour 2026, cette option n’est plus irrévocable : se
                  tromper coûte moins cher qu’avant.
                {:else}
                  <strong>Celle-ci reste irrévocable.</strong> La loi de finances pour 2026 n’a levé ce
                  caractère que pour la case 2OP ; l’article qui régit celle-ci dit toujours « option
                  expresse et irrévocable ». Une fois exercée pour l’année, on ne revient pas dessus.
                {/if}
              </li>
            </ul>
          </div>
        {/each}

        {#if line.note}<p class="note small">{line.note}</p>{/if}
        {#if line.box.entryNote}<p class="muted small">{line.box.entryNote}</p>{/if}
        <p class="muted small families">
          {line.families.map((f) => FAMILY_LABELS[f]).join(' · ')} — {line.box.ref}
        </p>
      </li>
    {/each}
  </ol>

  <p class="sr-only" role="status">
    {copied === null ? '' : `Montant de la case ${copied} copié.`}
  </p>
{/if}

{#if report.caveats.length > 0}
  <section class="card caveats" aria-labelledby="caveats-heading">
    <h2 id="caveats-heading">Ce que cette liste ne sait pas</h2>
    <ul>
      {#each report.caveats as caveat, i (i)}
        <li><strong>{FAMILY_LABELS[caveat.family]}</strong> — {caveat.text}</li>
      {/each}
    </ul>
  </section>
{/if}

{#if assumptions.length > 0}
  <details class="card">
    <summary>Les conventions de calcul, mot pour mot</summary>
    <p class="muted small">
      Ce que l’application décide faute de règle écrite, ou faute de données. Une convention n’est
      pas une règle de droit : vous pouvez la contester.
    </p>
    {#each assumptions as [family, list] (family)}
      <h3>{family}</h3>
      <ul>
        {#each list as text (text)}
          <li class="small">{text}</li>
        {/each}
      </ul>
    {/each}
  </details>
{/if}

<style>
  .intro h1 {
    margin: 0 0 var(--space-2);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .year {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .line {
    display: grid;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .code {
    font-weight: 700;
    font-size: var(--fs-lg);
    font-variant-numeric: tabular-nums;
  }
  .badge {
    padding: 2px var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .badge.entry {
    border-style: dashed;
  }
  .form {
    margin-left: auto;
    font-size: var(--fs-sm);
  }
  .label {
    margin: 0;
  }
  .amounts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .amounts li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .amount-code {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .amount {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .copy {
    min-height: 32px;
    min-width: 72px;
    padding: 0 var(--space-2);
    font-size: var(--fs-sm);
  }
  .terms {
    flex-basis: 100%;
  }
  .note {
    margin: 0;
    padding: var(--space-2);
    border-left: 3px solid var(--warn);
    background: var(--bg-sunken);
  }
  .families {
    margin: 0;
  }
  .arbitrage {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .arbitrage h3 {
    margin: 0;
    font-size: var(--fs-sm);
  }
  .arbitrage p {
    margin: 0;
  }
  .arbitrage .verdict {
    padding: var(--space-2);
    border-left: 3px solid var(--accent);
    background: var(--bg-elev);
  }
  .bases,
  .caveats {
    margin: 0;
    padding-left: var(--space-4);
    display: grid;
    gap: var(--space-1);
  }
  .caveats {
    color: var(--fg-muted);
  }
  .caveats ul,
  details ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  details h3 {
    margin: var(--space-3) 0 0;
    font-size: var(--fs-sm);
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
</style>
