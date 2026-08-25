<script lang="ts">
  import { untrack } from 'svelte';
  import { COINHOUSE_FEES, ZERO_FEE, breakEvenSellPrice, type FeeRate } from '$lib/domain/fees';
  import { parseDecimal, type Big } from '$lib/domain/money';
  import {
    qtyToRecoverStake,
    simulateBuy,
    simulateSell,
    spendToReachPru,
  } from '$lib/domain/simulate';
  import { MASK, fmtMasked, fmtMoney, fmtPct, fmtPrice, fmtQty, roundHalfUp } from '$lib/format/fr';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';

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

    <p class="context muted">
      Position : {qty(position.qty)}
      {asset.toUpperCase()} · PRU {showPrice(position.pru)} · coût {money(position.costBasis)}.
      Calcul local en euros{cur !== 'EUR' && usdPerEur !== null
        ? `, saisie et affichage en dollars au taux BCE du jour (1 € = ${fmtPrice(usdPerEur, 'USD')})`
        : ''}.
    </p>

    {#if mode === 'buy'}
      <form class="grid" onsubmit={(e) => e.preventDefault()}>
        <label class="field">
          <span>Montant à investir ({curWord}, tout compris)</span>
          <input type="text" inputmode="decimal" bind:value={spend} placeholder="ex. 500" />
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
          <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 45000" />
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
              <input type="text" inputmode="decimal" bind:value={customPct} />
            </label>
            <label class="field">
              <span>Frais fixes (€)</span>
              <input type="text" inputmode="decimal" bind:value={customFixed} />
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
              PRU : {showPrice(buyResult.pruBefore)} →
              <strong>{showPrice(buyResult.pruAfter)}</strong>
              {#if buyResult.pruChange !== null}({fmtPct(buyResult.pruChange)}){/if}
            </p>
            <p class="muted">
              Nouvelle position : {qty(buyResult.qtyAfter)}
              {asset.toUpperCase()} pour {money(buyResult.costAfter)} investis.
            </p>
          {:else}
            <p class="muted">Saisissez un montant et un prix.</p>
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
          <input type="text" inputmode="decimal" bind:value={sellQty} placeholder="ex. 0.5" />
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
          <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 65000" />
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
              <input type="text" inputmode="decimal" bind:value={customPct} />
            </label>
            <label class="field">
              <span>Frais fixes (€)</span>
              <input type="text" inputmode="decimal" bind:value={customFixed} />
            </label>
          </div>
        {/if}
        <div class="result" aria-live="polite">
          {#if breakEven !== null}
            <p>
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
            <p class="muted">Saisissez une quantité (au plus votre position) et un prix.</p>
          {/if}
        </div>
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
          <input type="text" inputmode="decimal" bind:value={targetPru} placeholder="ex. 40000" />
        </label>
        <label class="field">
          <span>Prix d’achat envisagé ({curWord})</span>
          <input type="text" inputmode="decimal" bind:value={price} placeholder="ex. 35000" />
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
</style>
