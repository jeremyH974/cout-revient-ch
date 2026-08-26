<script lang="ts">
  import { untrack } from 'svelte';
  import { COINHOUSE_FEES, ZERO_FEE, breakEvenSellPrice, type FeeRate } from '$lib/domain/fees';
  import { nowIso } from '$lib/clock';
  import { D, parseDecimal, type Big } from '$lib/domain/money';
  import { previewCession } from '$lib/domain/tax-fr';
  import {
    qtyToRecoverStake,
    simulateBuy,
    simulateSell,
    spendToReachPru,
  } from '$lib/domain/simulate';
  import { MASK, fmtMasked, fmtMoney, fmtPct, fmtPrice, fmtQty, roundHalfUp } from '$lib/format/fr';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';

  type SimulateMode = 'buy' | 'sell' | 'target';

  let {
    open = $bindable(false),
    asset,
    initialPrice = null,
    initialMode = 'buy',
  }: {
    open?: boolean;
    asset: string;
    initialPrice?: string | null;
    initialMode?: SimulateMode;
  } = $props();

  let mode = $state<SimulateMode>('buy');
  let spend = $state('');
  let price = $state('');
  let sellQty = $state('');
  let targetPru = $state('');
  type BuyFeeChoice = 'buy-sepa' | 'buy-card' | 'none' | 'custom';
  type SellFeeChoice = 'crypto-crypto' | 'sell-eur' | 'none' | 'custom';
  let buyFeeChoice = $state<BuyFeeChoice>('buy-sepa');
  let sellFeeChoice = $state<SellFeeChoice>('crypto-crypto');
  let customPct = $state('0');
  let customFixed = $state('0');

  /**
   * Estimation fiscale (décision n° 42) : repliée par défaut, elle ne charge l'historique des prix
   * qu'à l'ouverture — la feuille reste instantanée pour qui ne s'en sert pas.
   */
  let taxOpen = $state(false);
  let taxLoading = $state(false);
  $effect(() => {
    if (!taxOpen || history.status.loadedAt !== null || taxLoading) return;
    taxLoading = true;
    void history.ensure().finally(() => {
      taxLoading = false;
    });
  });

  const taxLedger = $derived(
    taxOpen && history.status.loadedAt !== null ? history.frenchTax() : null,
  );

  /** Aperçu de la vente en cours, en EUROS (la fiscalité française ne connaît que l'euro). */
  const taxPreview = $derived.by(() => {
    if (taxLedger === null || sellResult === null) return null;
    // Le simulateur calcule DÉJÀ en euros (`priceEurBig`, `positionEur`) : rien à convertir ici.
    // Le rapport, lui, est dans la devise d'affichage — la valeur globale doit repasser en euros.
    const proceeds = sellResult.netProceedsEur;
    const globalValue = app.eurFromDisplay(app.report.totals.value);
    if (globalValue === null) return null;
    const year = Number(nowIso().slice(0, 4));
    const current = taxLedger.years.find((y) => y.year === year);
    const preview = previewCession({
      ptaBefore: D(taxLedger.ptaAfter),
      proceedsEur: proceeds,
      globalValueEur: globalValue,
      year,
      yearProceedsEur: current ? D(current.proceedsEur) : undefined,
      yearNetEur: current ? D(current.netEur) : undefined,
    });
    if (preview === null) return null;
    return {
      year,
      proceeds,
      gain: D(preview.gainEur),
      share: D(preview.acquisitionShareEur),
      delta: D(preview.taxDeltaEur),
      yearNet: D(preview.yearNetEur),
      exempt: preview.exempt,
      rateLabel: preview.rateLabel,
      unknown: taxLedger.unknownGlobalValue,
    };
  });

  /** Montant en euros : la fiscalité s'exprime en euros même si l'app affiche en dollars. */
  const moneyEur = (value: Big, sign = false): string =>
    discreet ? fmtMasked('EUR') : fmtMoney(value, 'EUR', { sign });

  const position = $derived(app.positionEur(asset));
  const discreet = $derived(app.state.ui.discreet);
  const cur = $derived(app.currency);
  const usdPerEur = $derived(app.usdPerEurToday);
  const curWord = $derived(cur === 'USD' ? 'dollars' : 'euros');
  const curSymbol = $derived(cur === 'USD' ? '$' : '€');
  /**
   * Le moteur ne voit que des euros : la saisie en dollars est convertie au taux BCE du jour à
   * l'entrée, les résultats reconvertis à l'affichage (même taux — l'aller-retour est exact).
   */
  const toEur = (v: Big | null): Big | null =>
    v === null ? null : cur === 'EUR' ? v : usdPerEur === null ? null : v.div(usdPerEur);
  const money = (v: Big | null): string =>
    v === null ? '—' : discreet ? fmtMasked(cur) : fmtMoney(app.displayFromEur(v), cur);
  const moneySigned = (v: Big | null): string =>
    v === null
      ? '—'
      : discreet
        ? fmtMasked(cur)
        : fmtMoney(app.displayFromEur(v), cur, { sign: true });
  const showPrice = (v: Big | string | null): string =>
    v === null ? '—' : fmtPrice(app.displayFromEur(v), cur);
  const qty = (v: Big | null): string => (v === null ? '—' : discreet ? MASK : fmtQty(v));
  const spotEur = $derived.by((): string | null => {
    const quote = app.quotes[asset];
    return quote ? quote.priceEur : null;
  });

  /**
   * À l'ouverture SEULEMENT (corps `untrack`é, sinon une cotation qui bouge pendant la saisie
   * réinitialiserait les champs) : prix prérempli (alerte ou cours), champs remis à zéro.
   */
  let wasOpen = false;
  $effect(() => {
    const opening = open && !wasOpen;
    wasOpen = open;
    if (!opening) return;
    untrack(() => {
      mode = initialMode;
      // Suggestion éditable (2 décimales suffisent), dans la devise d'affichage : `initialPrice`
      // arrive en euros (journal des alertes), le champ se remplit dans la devise du toggle.
      const baseEur = initialPrice ?? spotEur;
      const shown = baseEur === null ? null : app.displayFromEur(baseEur);
      price = shown === null ? '' : shown.round(2).toString();
      spend = '';
      sellQty = '';
      targetPru = '';
    });
  });

  const parseInput = (raw: string): Big | null => parseDecimal(raw.trim().replace(',', '.'));

  const customFee = $derived.by((): FeeRate | null => {
    const pct = parseInput(customPct);
    const fixed = parseInput(customFixed);
    if (pct === null || fixed === null || pct.lt('0') || pct.gte('100') || fixed.lt('0'))
      return null;
    return { pctFee: pct.toString(), fixedEur: fixed.toString() };
  });
  const buyFee = $derived.by((): FeeRate | null =>
    buyFeeChoice === 'none'
      ? ZERO_FEE
      : buyFeeChoice === 'custom'
        ? customFee
        : COINHOUSE_FEES[buyFeeChoice],
  );
  const sellFee = $derived.by((): FeeRate | null =>
    sellFeeChoice === 'none'
      ? ZERO_FEE
      : sellFeeChoice === 'custom'
        ? customFee
        : COINHOUSE_FEES[sellFeeChoice],
  );

  /** Prix saisi (devise d'affichage) ramené en euros pour le moteur. */
  const priceEurBig = $derived(toEur(parseInput(price)));
  const simPosition = $derived(
    position ? { qty: position.qty, costBasis: position.costBasis } : null,
  );

  const buyResult = $derived.by(() => {
    const spendEur = toEur(parseInput(spend));
    if (!simPosition || spendEur === null || priceEurBig === null || buyFee === null) return null;
    return simulateBuy(simPosition, spendEur, priceEurBig, buyFee);
  });

  const sellResult = $derived.by(() => {
    const qtyBig = parseInput(sellQty);
    if (!simPosition || qtyBig === null || priceEurBig === null || sellFee === null) return null;
    return simulateSell(simPosition, qtyBig, priceEurBig, sellFee);
  });

  /** Prix d'équilibre frais inclus (objectif 0 %) au barème de sortie choisi. */
  const breakEven = $derived.by(() => {
    if (!position || position.pru === null || sellFee === null) return null;
    return breakEvenSellPrice(position.pru, position.qty, sellFee);
  });

  const recoupQty = $derived.by(() => {
    if (!position || priceEurBig === null || sellFee === null) return null;
    const needed = qtyToRecoverStake(position.netInvested, priceEurBig, sellFee);
    return needed !== null && needed.lte(position.qty) ? needed : null;
  });

  const targetResult = $derived.by(() => {
    const targetEur = toEur(parseInput(targetPru));
    if (!simPosition || targetEur === null || priceEurBig === null) return null;
    const spendNeeded = spendToReachPru(simPosition, priceEurBig, targetEur);
    return spendNeeded === null ? null : { spendNeeded, qtyNeeded: spendNeeded.div(priceEurBig) };
  });

  /** Variation de PRU masquée quand elle arrondit à zéro (« (0,0 %) » est du bruit). */
  const pruChangeText = $derived.by((): string | null => {
    const change = buyResult?.pruChange ?? null;
    if (change === null || roundHalfUp(change, 3).eq('0')) return null;
    return fmtPct(change);
  });

  /**
   * Équivalent en actif du montant saisi, affiché SOUS le champ : attrape immédiatement la
   * confusion montant ↔ quantité (taper « 0.5 » en pensant 0,5 BTC dans un champ en dollars).
   */
  const spendEquivalent = $derived.by((): Big | null => {
    const spendEur = toEur(parseInput(spend));
    if (spendEur === null || priceEurBig === null || !priceEurBig.gt('0')) return null;
    return spendEur.div(priceEurBig);
  });

  function setSellPct(pct: string): void {
    if (!position) return;
    sellQty =
      pct === '100'
        ? position.qty.toString()
        : roundHalfUp(position.qty.times(pct).div('100'), 9).toString();
  }

  const MODES: readonly { id: SimulateMode; label: string }[] = [
    { id: 'buy', label: 'Acheter' },
    { id: 'sell', label: 'Vendre' },
    { id: 'target', label: 'Objectif de PRU' },
  ];
</script>

<Sheet bind:open title="Simuler — {asset.toUpperCase()}">
  {#if !position}
    <p class="muted">Aucune position connue pour cet actif.</p>
  {:else}
    <nav class="modes" aria-label="Type de simulation">
      {#each MODES as m (m.id)}
        <button type="button" class:active={mode === m.id} onclick={() => (mode = m.id)}
          >{m.label}</button
        >
      {/each}
    </nav>

    <div class="position-card">
      <div>
        <span class="stat-label">Détenu</span>
        <span class="stat-value">{qty(position.qty)} {asset.toUpperCase()}</span>
      </div>
      <div>
        <span class="stat-label">PRU</span>
        <span class="stat-value">{showPrice(position.pru)}</span>
        {#if cur !== 'EUR' && position.pru !== null}
          <span class="stat-sub">= {fmtPrice(position.pru)}</span>
        {/if}
      </div>
      <div>
        <span class="stat-label">Investi</span>
        <span class="stat-value">{money(position.costBasis)}</span>
      </div>
    </div>
    <p class="context muted">
      Calcul local en euros{cur !== 'EUR' && usdPerEur !== null
        ? ` ; saisie et affichage en dollars au taux BCE du jour (1 € = ${fmtPrice(usdPerEur, 'USD')}). Le PRU en dollars bouge avec ce taux — votre PRU en euros, lui, ne change pas`
        : ''}.
    </p>

    {#if mode === 'buy'}
      <form class="grid" onsubmit={(e) => e.preventDefault()}>
        <label class="field">
          <span>Montant à investir ({curWord}, tout compris)</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={spend} placeholder="ex. 500" />
            <span class="unit" aria-hidden="true">{curSymbol}</span>
          </span>
          {#if spendEquivalent !== null}
            <span class="equiv">≈ {qty(spendEquivalent)} {asset.toUpperCase()} au prix saisi</span>
          {/if}
        </label>
        <div class="chips" role="group" aria-label="Montants rapides">
          {#each ['100', '250', '500', '1000'] as amount (amount)}
            <button type="button" class="chip" onclick={() => (spend = amount)}
              >{amount}&nbsp;{curSymbol}</button
            >
          {/each}
        </div>
        <label class="field">
          <span>Prix d’exécution ({curWord})</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 45000" />
            <span class="unit" aria-hidden="true">{curSymbol}</span>
          </span>
        </label>
        <label class="field">
          <span>Frais (grille Coinhouse, 18/08/2026 — modifiables)</span>
          <select bind:value={buyFeeChoice}>
            <option value="buy-sepa">Achat par virement / Compte Euro — 0,99 % + 0,12 €</option>
            <option value="buy-card">Achat par carte — 1,99 % + 0,12 €</option>
            <option value="none">Sans frais (prix all-in déjà connu)</option>
            <option value="custom">Personnalisés…</option>
          </select>
        </label>
        {#if buyFeeChoice === 'custom'}
          <div class="custom">
            <label class="field">
              <span>Frais en %</span>
              <span class="affix">
                <input type="text" inputmode="decimal" bind:value={customPct} />
                <span class="unit" aria-hidden="true">%</span>
              </span>
            </label>
            <label class="field">
              <span>Frais fixes (€)</span>
              <span class="affix">
                <input type="text" inputmode="decimal" bind:value={customFixed} />
                <span class="unit" aria-hidden="true">€</span>
              </span>
            </label>
          </div>
        {/if}
        <div class="result" aria-live="polite">
          {#if buyResult}
            <p>
              Quantité reçue : <strong>{qty(buyResult.qtyBought)} {asset.toUpperCase()}</strong>
              <span class="muted">· frais {money(buyResult.feesEur)}</span>
            </p>
            <p>
              PRU : {showPrice(buyResult.pruBefore)} <span class="arrow">→</span>
              <strong>{showPrice(buyResult.pruAfter)}</strong>
              {#if pruChangeText !== null}<span class="delta">{pruChangeText}</span>{/if}
            </p>
            <p class="muted">
              Nouvelle position : {qty(buyResult.qtyAfter)}
              {asset.toUpperCase()} · exposition {money(position.costBasis)}
              <span class="arrow">→</span>
              {money(buyResult.costAfter)}.
            </p>
          {:else}
            <p class="muted">
              Saisissez un montant et un prix pour voir : quantité reçue, frais, nouveau PRU et
              exposition — mêmes règles de calcul que le moteur.
            </p>
          {/if}
        </div>
        <p class="notice">
          Renforcer à la baisse abaisse votre PRU mais augmente le montant exposé à cet actif : si
          le cours continue de baisser, la perte porte sur une position plus grande. Simulation
          fournie à titre informatif, pas un conseil en investissement.
        </p>
      </form>
    {:else if mode === 'sell'}
      <form class="grid" onsubmit={(e) => e.preventDefault()}>
        <label class="field">
          <span>Quantité à vendre ({asset.toUpperCase()})</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={sellQty} placeholder="ex. 0.5" />
            <span class="unit" aria-hidden="true">{asset.toUpperCase()}</span>
          </span>
        </label>
        <div class="chips" role="group" aria-label="Fractions rapides">
          {#each ['25', '50', '75', '100'] as pct (pct)}
            <button type="button" class="chip" onclick={() => setSellPct(pct)}>{pct}&nbsp;%</button>
          {/each}
          <button
            type="button"
            class="chip"
            disabled={recoupQty === null}
            title={recoupQty === null
              ? 'Indisponible : mise déjà récupérée, ou prix trop bas'
              : 'Vendre juste assez pour récupérer votre mise nette'}
            onclick={() => recoupQty && (sellQty = roundHalfUp(recoupQty, 9).toString())}
            >Récupérer ma mise</button
          >
        </div>
        <label class="field">
          <span>Prix de vente ({curWord})</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 65000" />
            <span class="unit" aria-hidden="true">{curSymbol}</span>
          </span>
        </label>
        <label class="field">
          <span>Sortie et frais (grille Coinhouse, 18/08/2026 — modifiables)</span>
          <select bind:value={sellFeeChoice}>
            <option value="crypto-crypto"
              >Conversion en stablecoin (USDC, EURCV) — 0,79 % + 0,12 €</option
            >
            <option value="sell-eur">Vente en euros — 1,29 % + 0,12 €</option>
            <option value="none">Sans frais</option>
            <option value="custom">Personnalisés…</option>
          </select>
        </label>
        {#if sellFeeChoice === 'custom'}
          <div class="custom">
            <label class="field">
              <span>Frais en %</span>
              <span class="affix">
                <input type="text" inputmode="decimal" bind:value={customPct} />
                <span class="unit" aria-hidden="true">%</span>
              </span>
            </label>
            <label class="field">
              <span>Frais fixes (€)</span>
              <span class="affix">
                <input type="text" inputmode="decimal" bind:value={customFixed} />
                <span class="unit" aria-hidden="true">€</span>
              </span>
            </label>
          </div>
        {/if}
        <div class="result" aria-live="polite">
          {#if breakEven !== null}
            <p class="be">
              Prix d’équilibre <strong>frais inclus</strong> :
              <strong>{showPrice(breakEven)}</strong>
              <span class="muted">— au-dessus, la vente est gagnante net de frais.</span>
            </p>
          {/if}
          {#if sellResult}
            <p>
              Produit brut {money(sellResult.grossEur)} − frais {money(sellResult.feesEur)} =
              <strong>{money(sellResult.netProceedsEur)}</strong> encaissés.
            </p>
            <p>
              Résultat réalisé net de frais :
              <strong class={sellResult.realizedEur.lt('0') ? 'loss' : 'gain'}
                >{moneySigned(sellResult.realizedEur)}</strong
              >
            </p>
            <p class="muted">
              Reste : {qty(sellResult.qtyAfter)}
              {asset.toUpperCase()} ({money(sellResult.costAfter)} investis). Une vente ne change jamais
              votre PRU{sellResult.pruAfter
                ? ` : il reste à ${showPrice(sellResult.pruAfter)}`
                : ' — position soldée'}.
            </p>
          {:else}
            <p class="muted">
              Saisissez une quantité (au plus votre position) et un prix pour voir : produit net
              encaissé, résultat net de frais et position restante.
            </p>
          {/if}
        </div>
        {#if sellFeeChoice === 'sell-eur'}
          <details class="tax" bind:open={taxOpen}>
            <summary>Estimation fiscale française (avant de vendre)</summary>
            {#if taxLoading}
              <p class="muted">Chargement de l’historique des prix…</p>
            {:else if taxPreview}
              <p>
                Plus-value imposable estimée :
                <strong class={taxPreview.gain.lt('0') ? 'loss' : 'gain'}
                  >{moneyEur(taxPreview.gain, true)}</strong
                >
                <span class="muted"
                  >— prix de cession {moneyEur(taxPreview.proceeds)} moins {moneyEur(
                    taxPreview.share,
                  )} de prix d’acquisition imputé.</span
                >
              </p>
              <p>
                {#if taxPreview.delta.gt('0')}
                  Impôt supplémentaire dû à cette vente :
                  <strong>{moneyEur(taxPreview.delta)}</strong>
                  <span class="muted"
                    >— prélèvement forfaitaire unique {taxPreview.rateLabel}, sur {moneyEur(
                      taxPreview.yearNet,
                      true,
                    )} de résultat net {taxPreview.year}.</span
                  >
                {:else if taxPreview.delta.lt('0')}
                  Cette vente <strong>réduirait</strong> l’impôt de l’année de
                  <strong>{moneyEur(taxPreview.delta.abs())}</strong>
                  <span class="muted"
                    >— sa moins-value s’impute sur vos plus-values {taxPreview.year}.</span
                  >
                {:else if taxPreview.exempt}
                  Aucun impôt estimé
                  <span class="muted"
                    >— vos cessions {taxPreview.year} restent sous le seuil de 305 €, donc exonérées.</span
                  >
                {:else}
                  Aucun impôt estimé
                  <span class="muted"
                    >— l’année {taxPreview.year} resterait nette perdante ({moneyEur(
                      taxPreview.yearNet,
                      true,
                    )}) : rien à payer, et cette perte ne se reporte pas sur les années suivantes.</span
                  >
                {/if}
              </p>
              {#if taxPreview.unknown > 0}
                <p class="muted">
                  {taxPreview.unknown} cession passée n’a pas pu être chiffrée (historique de prix trop
                  court) : le prix d’acquisition restant, donc cette estimation, sont approximatifs.
                </p>
              {/if}
            {:else}
              <p class="muted">
                Saisissez une quantité et un prix pour voir la plus-value imposable estimée et
                l’impôt correspondant.
              </p>
            {/if}
            <p class="muted">
              Méthode globale de l’article 150 VH bis : la plus-value se calcule sur le PORTEFEUILLE
              entier, pas sur cet actif — elle n’a rien à voir avec le PRU affiché plus haut. Le
              calcul suppose que cette app contient tous vos actifs numériques. Estimation, ni
              déclaration ni conseil fiscal.
            </p>
          </details>
        {/if}
        <p class="notice">
          Convertir vers un stablecoin (USDC, EURCV) coûte 0,79 % et reste un échange crypto↔crypto
          (sursis fiscal de l’art. 150 VH bis) ; vendre en euros coûte 1,29 % et constitue une
          cession imposable. Information indicative, ni conseil fiscal ni conseil en investissement.
        </p>
      </form>
    {:else}
      <form class="grid" onsubmit={(e) => e.preventDefault()}>
        <label class="field">
          <span>PRU visé ({curWord})</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={targetPru} placeholder="ex. 40000" />
            <span class="unit" aria-hidden="true">{curSymbol}</span>
          </span>
        </label>
        <label class="field">
          <span>Prix d’achat envisagé ({curWord})</span>
          <span class="affix">
            <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 35000" />
            <span class="unit" aria-hidden="true">{curSymbol}</span>
          </span>
        </label>
        <div class="result" aria-live="polite">
          {#if targetResult}
            <p>
              Il faudrait investir <strong>{money(targetResult.spendNeeded)}</strong>
              <span class="muted"
                >(≈ {qty(targetResult.qtyNeeded)} {asset.toUpperCase()}, montant tout compris)</span
              >
            </p>
            <p class="muted">
              Vérification : ce montant au prix saisi amène le PRU sur la cible — mêmes règles que
              le moteur.
            </p>
          {:else}
            <p class="muted">
              La cible doit être STRICTEMENT entre le prix d’achat et votre PRU actuel ({showPrice(
                position.pru,
              )}) : en moyennant, le PRU se déplace vers le prix payé sans jamais l’atteindre.
            </p>
          {/if}
        </div>
      </form>
    {/if}
  {/if}
</Sheet>

<style>
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: var(--space-3);
  }
  .modes button {
    min-height: var(--tap);
    color: var(--fg-muted);
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .modes button.active {
    color: var(--accent-fg);
    background: var(--accent);
  }
  .position-card {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
  }
  .position-card > div {
    display: grid;
    gap: 2px;
    min-width: 0;
    align-content: start;
  }
  .stat-label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-muted);
  }
  .stat-value {
    font-size: var(--fs-sm);
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .stat-sub {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  .context {
    font-size: var(--fs-xs);
    margin-bottom: var(--space-3);
  }
  .grid {
    display: grid;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  .field > span {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
  input,
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
    width: 100%;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: var(--space-1) var(--space-3);
    min-height: 32px;
    font-size: var(--fs-xs);
    color: var(--fg);
  }
  .chip:disabled {
    opacity: 0.5;
  }
  .custom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .result {
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    font-size: var(--fs-sm);
    display: grid;
    gap: var(--space-1);
  }
  .gain {
    color: var(--gain);
  }
  .loss {
    color: var(--loss);
  }
  .notice {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .affix {
    position: relative;
    display: block;
  }
  .affix input {
    padding-right: 52px;
  }
  .unit {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    pointer-events: none;
    max-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .equiv {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .arrow {
    color: var(--fg-muted);
  }
  .delta {
    border: 1px solid var(--accent);
    color: var(--accent);
    border-radius: 999px;
    padding: 0 6px;
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .be {
    border-left: 3px solid var(--accent);
    padding-left: var(--space-2);
  }
</style>
