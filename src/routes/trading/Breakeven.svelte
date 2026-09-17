<script lang="ts">
  /**
   * Onglet « Seuil » de l'espace Trading (décision n° 158) : AVANT d'entrer, le gain brut minimum
   * pour payer les frais d'un aller-retour, par taille et par type d'ordre. Prix pré-rempli par le
   * cours actuel (à défaut, le dernier prix exécuté), taux par la médiane de ceux réellement payés,
   * tailles mémorisées par actif — tout reste modifiable. Les chiffres viennent de `sizeBreakeven` ;
   * cet écran ne fait que lire les champs et afficher.
   */
  import { D, ONE, ZERO, type Big } from '$lib/domain/money';
  import { observedFeeRates, sizeBreakeven } from '$lib/domain/trading/costs';
  import type { Execution } from '$lib/domain/trading/types';
  import { fmtDate, fmtMasked, fmtMoney, fmtPrice, fmtQty, fmtSmallPct } from '$lib/format/fr';
  import {
    parseFrDecimal,
    parseRateInput,
    parseSizeList,
    priceInputText,
    qtyInputText,
    rateInputText,
  } from '$lib/format/trade-costs';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';

  const executions = $derived(
    app.tradingReport.accounts.flatMap((a) => a.executions).filter((x) => x.market === 'perp'),
  );
  /** Actifs tradés en perps, du plus récemment exécuté au plus ancien. */
  const symbols = $derived.by((): string[] => {
    const seen: string[] = [];
    for (const x of [...executions].sort((a, b) => b.time - a.time))
      if (!seen.includes(x.symbol)) seen.push(x.symbol);
    return seen;
  });
  let chosen = $state('');
  const symbol = $derived(symbols.includes(chosen) ? chosen : (symbols[0] ?? ''));

  // --- Prix : saisi, sinon cours actuel, sinon dernier prix exécuté -----------------------------
  const lastFill = $derived(
    executions
      .filter((x) => x.symbol === symbol)
      .reduce<Execution | null>(
        (last, x) => (last === null || x.time > last.time ? x : last),
        null,
      ),
  );
  const livePrice = $derived.by((): Big | null => {
    const quote = app.quotes[symbol.toLowerCase()];
    const usdPerEur = app.usdPerEurToday;
    return quote && !quote.stale && usdPerEur ? D(quote.priceEur).times(usdPerEur) : null;
  });
  let typedPrices = $state<Record<string, string>>({});
  const priceText = $derived(
    typedPrices[symbol] ?? priceInputText(livePrice ?? (lastFill ? D(lastFill.price) : null)),
  );

  // --- Taux : saisis, sinon médiane de ceux réellement payés ------------------------------------
  const observed = $derived(observedFeeRates(executions));
  let typedTaker = $state<string | null>(null);
  let typedMaker = $state<string | null>(null);
  const takerText = $derived(typedTaker ?? rateInputText(observed.taker));
  const makerText = $derived(typedMaker ?? rateInputText(observed.maker));

  // --- Tailles : mémorisées par actif, sinon la taille du dernier trade -------------------------
  const lastTripSize = $derived(
    app.roundTrips.find((t) => t.trip.symbol === symbol)?.trip.qtyMax ?? null,
  );
  const sizesText = $derived(
    app.state.ui.breakevenSizes[symbol] ?? (lastTripSize ? qtyInputText(lastTripSize) : ''),
  );

  const price = $derived(parseFrDecimal(priceText));
  const taker = $derived(parseRateInput(takerText));
  const maker = $derived(parseRateInput(makerText));
  const sizes = $derived(parseSizeList(sizesText));

  const SCENARIOS = [
    { id: 'taker-taker', label: 'Taker → taker', entry: 'taker', exit: 'taker' },
    { id: 'maker-taker', label: 'Maker → taker', entry: 'maker', exit: 'taker' },
    { id: 'maker-maker', label: 'Maker → maker', entry: 'maker', exit: 'maker' },
  ] as const;
  const rows = $derived(
    SCENARIOS.map((s) => {
      const entry = s.entry === 'taker' ? taker : maker;
      const exit = s.exit === 'taker' ? taker : maker;
      if (entry === null || exit === null || price === null || !price.gt(ZERO))
        return { ...s, unit: null, cells: null };
      return {
        ...s,
        unit: sizeBreakeven(price, ONE, entry, exit),
        cells: sizes.map((qty) => sizeBreakeven(price, qty, entry, exit)),
      };
    }),
  );

  const priceSource = $derived(
    typedPrices[symbol] !== undefined
      ? 'prix saisi'
      : livePrice
        ? 'cours actuel'
        : lastFill
          ? `dernier prix exécuté, le ${fmtDate(lastFill.at)}`
          : 'à saisir',
  );
  const ratesSource = $derived(
    typedTaker !== null || typedMaker !== null
      ? 'saisis'
      : observed.taker && observed.maker
        ? 'médiane de vos dernières exécutions de chaque type'
        : observed.taker
          ? 'médiane de vos dernières exécutions taker — aucune exécution maker, taux maker à saisir'
          : observed.maker
            ? 'médiane de vos dernières exécutions maker — aucune exécution taker, taux taker à saisir'
            : 'à saisir',
  );
  const usd = (value: Big): string =>
    app.state.ui.discreet ? fmtMasked('USD') : fmtMoney(value, 'USD');
</script>

<AppBar title="Seuil" back={{ name: 'trading' }} />
<TradingTabs active="tradeBreakeven" />

{#if symbols.length === 0}
  <section class="card">
    <p class="muted">
      Ce simulateur part de vos exécutions Hyperliquid : le cours de l'actif et les taux de frais
      que vous payez réellement. Synchronisez un compte depuis le
      <a href={router.href({ name: 'trading' })}>tableau de bord</a>.
    </p>
  </section>
{:else}
  <section class="card inputs" aria-labelledby="inputs-title">
    <h2 id="inputs-title">Combien gagner, au minimum, pour payer les frais ?</h2>
    <p class="muted small">
      Le gain brut en dessous duquel un aller-retour perd de l'argent, selon la taille de la
      position et le type d'ordre à l'entrée et à la sortie. En pourcentage, ce seuil ne dépend pas
      de la taille : seule sa valeur grandit avec elle.
    </p>
    <div class="grid">
      <label class="field"
        >Actif
        <select value={symbol} onchange={(e) => (chosen = e.currentTarget.value)}>
          {#each symbols as s (s)}
            <option value={s}>{s}</option>
          {/each}
        </select>
      </label>
      <label class="field"
        >Tailles ({symbol})
        <input
          type="text"
          value={sizesText}
          oninput={(e) => app.setBreakevenSizes(symbol, e.currentTarget.value)}
          placeholder="ex. 10 20 30"
          maxlength="200"
        />
      </label>
      <label class="field"
        >Prix ($)
        <input
          type="text"
          inputmode="decimal"
          value={priceText}
          oninput={(e) => (typedPrices = { ...typedPrices, [symbol]: e.currentTarget.value })}
          placeholder="ex. 65 000"
        />
      </label>
      <label class="field"
        >Frais taker (%)
        <input
          type="text"
          inputmode="decimal"
          value={takerText}
          oninput={(e) => (typedTaker = e.currentTarget.value)}
          placeholder="ex. 0,045"
        />
      </label>
      <label class="field"
        >Frais maker (%)
        <input
          type="text"
          inputmode="decimal"
          value={makerText}
          oninput={(e) => (typedMaker = e.currentTarget.value)}
          placeholder="ex. 0,015"
        />
      </label>
    </div>
    <p class="muted small">Prix : {priceSource}. Taux : {ratesSource}.</p>
  </section>

  <section class="card results" aria-labelledby="results-title">
    <h2 id="results-title">Gain brut minimum</h2>
    {#if sizes.length === 0 || price === null || !price.gt(ZERO)}
      <p class="muted">Saisissez au moins une taille et un prix pour obtenir le seuil.</p>
    {:else}
      <!-- Un tableau qui défile horizontalement doit rester accessible au clavier (WCAG 2.1.1). -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="scroll"
        tabindex="0"
        role="region"
        aria-label="Gain brut minimum — tableau défilant"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Entrée → sortie</th>
              <th scope="col" class="num">Seuil</th>
              {#each sizes as qty (qty.toString())}
                <th scope="col" class="num">{fmtQty(qty)} {symbol}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.id)}
              <tr>
                <th scope="row">{row.label}</th>
                {#if row.unit && row.cells}
                  <td class="num"
                    >{fmtSmallPct(row.unit.move)}<span class="sub"
                      >{fmtPrice(row.unit.perUnit, 'USD')} par {symbol}</span
                    ></td
                  >
                  {#each row.cells as cell (cell.qty.toString())}
                    <td class="num"
                      ><Money
                        value={app.usdcToDisplay(cell.grossMin)}
                      />{#if app.currency !== 'USD'}<span class="sub">{usd(cell.grossMin)}</span
                        >{/if}</td
                    >
                  {/each}
                {:else}
                  <td class="num">—</td>
                  {#each sizes as qty (qty.toString())}
                    <td class="num">—</td>
                  {/each}
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small">
        Gain brut minimum = frais d'entrée + frais de sortie, calculés au prix saisi. Ne sont pas
        comptés : le funding, réglé à chaque heure pile tant que la position reste ouverte, et le
        glissement de prix d'un ordre au marché — ils s'ajoutent au seuil. Taker : l'ordre est
        exécuté tout de suite contre le carnet, au tarif plein ; maker : il attend dans le carnet,
        au tarif réduit.
      </p>
    {/if}
  </section>
{/if}

<style>
  .inputs,
  .results {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  p {
    margin: 0;
  }
  .grid {
    display: grid;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  input,
  select {
    font: inherit;
    font-weight: 400;
  }
  .scroll {
    overflow-x: auto;
  }
  .scroll:focus-visible {
    outline: 2px solid var(--accent-trading);
    outline-offset: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    vertical-align: top;
  }
  th.num,
  td.num {
    text-align: right;
  }
  thead th {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sub {
    display: block;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }
  }
</style>
