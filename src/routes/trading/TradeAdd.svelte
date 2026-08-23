<script lang="ts">
  /**
   * Saisie manuelle d'un trade (plateforme sans API) : pensée pour le téléphone, ~20 s.
   * Les prix et la taille sont saisis, le P&L est calculé — jamais saisi. Sortie vide = position
   * encore ouverte. Le trade rejoint la liste et peut recevoir son journal.
   */
  import { MANUAL_TRADING_ACCOUNT_ID } from '$lib/domain/types';
  import type { ManualTrade } from '$lib/domain/trading/journal';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let symbol = $state('');
  let direction = $state<'long' | 'short'>('long');
  let qty = $state('');
  let entryPrice = $state('');
  let exitPrice = $state('');
  let fees = $state('');
  let quote = $state<'USD' | 'EUR'>('USD');
  let openedAt = $state('');
  let closedAt = $state('');
  let accountId = $state(MANUAL_TRADING_ACCOUNT_ID);

  const manualAccounts = $derived(
    app.accounts.filter((a) => a.space === 'trading' && a.kind === 'manual'),
  );

  const DECIMAL = /^\d+(\.\d+)?$/;
  const clean = (raw: string): string | null => {
    const text = raw.trim().replace(',', '.');
    return DECIMAL.test(text) ? text : null;
  };
  /** `datetime-local` → NaiveDateTime (les secondes manquent souvent). */
  const naive = (raw: string): string | null =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)
      ? raw.length === 16
        ? `${raw}:00`
        : raw
      : null;

  function save(): void {
    const cleanSymbol = symbol.trim().toUpperCase().replace(/\s+/g, '');
    if (cleanSymbol === '' || !/^[A-Z0-9-]{1,20}$/.test(cleanSymbol))
      return toasts.push('Symbole requis (lettres et chiffres, ex. BTC).', 'error');
    const q = clean(qty);
    const entry = clean(entryPrice);
    if (q === null || entry === null)
      return toasts.push('Taille et prix d’entrée requis (nombres positifs).', 'error');
    const openedNaive = naive(openedAt);
    if (openedNaive === null) return toasts.push('Date d’entrée requise.', 'error');
    const exit = exitPrice.trim() === '' ? null : clean(exitPrice);
    if (exitPrice.trim() !== '' && exit === null)
      return toasts.push('Prix de sortie invalide.', 'error');
    const closedNaive = closedAt.trim() === '' ? null : naive(closedAt);
    if (exit !== null && closedNaive === null)
      return toasts.push('Date de sortie requise quand le prix de sortie est renseigné.', 'error');
    if (closedNaive !== null && closedNaive < openedNaive)
      return toasts.push('La sortie ne peut pas précéder l’entrée.', 'error');
    const trade: Omit<ManualTrade, 'id'> = {
      accountId,
      symbol: cleanSymbol,
      direction,
      qty: q,
      entryPrice: entry,
      exitPrice: exit,
      openedAt: openedNaive,
      closedAt: exit === null ? null : closedNaive,
      fees: clean(fees) ?? '0',
      quote,
    };
    const saved = app.addManualTrade(trade);
    toasts.push('Trade enregistré : ajoutez-lui une note de journal.', 'success');
    router.navigate({ name: 'trade', id: `man:${saved.id}` });
  }
</script>

<AppBar title="Ajouter un trade" back={{ name: 'trades' }} />
<TradingTabs active="trades" />

<form
  class="card"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <p class="muted small">
    Pour un compte Hyperliquid, rien à saisir : les trades se reconstruisent tout seuls à la
    synchronisation. Ce formulaire sert aux autres plateformes.
  </p>
  <div class="grid">
    <label class="field"
      >Symbole
      <input type="text" bind:value={symbol} placeholder="ex. BTC" maxlength="20" required />
    </label>
    <fieldset class="field">
      <legend>Sens</legend>
      <div class="segments" role="group" aria-label="Sens du trade">
        <button
          type="button"
          class="segment"
          aria-pressed={direction === 'long'}
          onclick={() => (direction = 'long')}>Long</button
        >
        <button
          type="button"
          class="segment"
          aria-pressed={direction === 'short'}
          onclick={() => (direction = 'short')}>Short</button
        >
      </div>
    </fieldset>
    <label class="field"
      >Taille
      <input type="text" inputmode="decimal" bind:value={qty} placeholder="ex. 0,5" required />
    </label>
    <label class="field"
      >Devise de cotation
      <select bind:value={quote}>
        <option value="USD">USD / USDC</option>
        <option value="EUR">EUR</option>
      </select>
    </label>
    <label class="field"
      >Prix d'entrée
      <input
        type="text"
        inputmode="decimal"
        bind:value={entryPrice}
        placeholder="ex. 60 000"
        required
      />
    </label>
    <label class="field"
      >Entrée le
      <input type="datetime-local" step="1" bind:value={openedAt} required />
    </label>
    <label class="field"
      >Prix de sortie (vide = encore ouvert)
      <input type="text" inputmode="decimal" bind:value={exitPrice} placeholder="ex. 64 000" />
    </label>
    <label class="field"
      >Sortie le
      <input type="datetime-local" step="1" bind:value={closedAt} />
    </label>
    <label class="field"
      >Frais totaux ({quote})
      <input type="text" inputmode="decimal" bind:value={fees} placeholder="0" />
    </label>
    {#if manualAccounts.length > 0}
      <label class="field"
        >Compte
        <select bind:value={accountId}>
          <option value={MANUAL_TRADING_ACCOUNT_ID}>Trades manuels</option>
          {#each manualAccounts as a (a.id)}
            {#if a.id !== MANUAL_TRADING_ACCOUNT_ID}
              <option value={a.id}>{a.label}</option>
            {/if}
          {/each}
        </select>
      </label>
    {/if}
  </div>
  <button class="primary" type="submit">Enregistrer le trade</button>
</form>

<style>
  form {
    display: grid;
    gap: var(--space-3);
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
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-1);
  }
  input,
  select {
    font: inherit;
    font-weight: 400;
  }
  .segments {
    display: flex;
    gap: var(--space-1);
  }
  .segment {
    flex: 1;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
  .segment[aria-pressed='true'] {
    background: var(--accent-trading);
    border-color: var(--accent-trading);
    color: var(--accent-fg);
  }
  .primary {
    justify-self: start;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
  }
  @media (min-width: 768px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
