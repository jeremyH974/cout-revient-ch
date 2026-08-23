<script lang="ts">
  import { COINHOUSE_ACCOUNT_ID, MANUAL_ACCOUNT_ID } from '$lib/domain/types';
  import { normalizeAssetCode } from '$lib/domain/assets';
  import { D } from '$lib/domain/money';
  import type { ManualEvent } from '$lib/domain/types';
  import { fmtDateTime, fmtMasked, fmtMoney } from '$lib/format/fr';
  import { parseNaiveDateTime } from '$lib/import/coinhouse/rows';
  import { TICKERS } from '$lib/pricing/tickers';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Qty from '../../components/shared/Qty.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  type Kind = ManualEvent['kind'];
  const kinds: { value: Kind; label: string; amount: string | null }[] = [
    { value: 'buy', label: 'Achat', amount: 'Total payé en € (frais inclus)' },
    { value: 'sell', label: 'Vente', amount: 'Total reçu en € (net de frais)' },
    { value: 'reward', label: 'Récompense', amount: 'Valeur en € à la réception (optionnel)' },
    { value: 'deposit', label: 'Dépôt', amount: "Coût d'acquisition en € (optionnel)" },
    { value: 'withdrawal', label: 'Retrait', amount: 'Valeur de cession en € (optionnel)' },
    { value: 'opening-balance', label: 'Solde initial', amount: 'Coût total en € de ce solde' },
  ];
  let kind = $state<Kind>('buy');
  let at = $state('');
  let asset = $state('');
  let qty = $state('');
  let amount = $state('');
  let note = $state('');
  /** Compte de rattachement : Coinhouse (participe au contrôle de solde) ou un compte hors Coinhouse. */
  let accountId = $state<string>(COINHOUSE_ACCOUNT_ID);
  const scope = $derived<'coinhouse' | 'external'>(
    accountId === COINHOUSE_ACCOUNT_ID ? 'coinhouse' : 'external',
  );
  const accountOptions = $derived.by(() => {
    const declared = Object.values(app.state.accounts).filter((a) => a.space === 'invest');
    return [
      { id: COINHOUSE_ACCOUNT_ID, label: 'Sur Coinhouse (absent de l’export)' },
      { id: MANUAL_ACCOUNT_ID, label: 'Hors Coinhouse (autre plateforme, wallet)' },
      ...declared.map((a) => ({ id: a.id, label: a.label })),
    ];
  });
  const current = $derived(kinds.find((k) => k.value === kind)!);
  const manualList = $derived(
    Object.values(app.state.manualEvents).sort((a, b) => b.at.localeCompare(a.at)),
  );

  /** Les saisies sont toujours en euros (devise des données), jamais converties ; masquées en mode discret. */
  const eur = (v: string): string =>
    app.state.ui.discreet ? fmtMasked('EUR') : fmtMoney(D(v), 'EUR');

  const num = (s: string): string | null => {
    const v = s.trim().replace(/\s/g, '').replace(',', '.');
    return /^\d+(\.\d+)?$/.test(v) ? v : null;
  };

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    const when = parseNaiveDateTime(at.replace('T', ' '));
    const code = normalizeAssetCode(asset);
    const quantity = num(qty);
    const eur = num(amount);
    if (!when) return toasts.push('Date invalide.', 'error');
    if (!code) return toasts.push('Actif manquant.', 'error');
    if (!quantity || Number(quantity) <= 0) return toasts.push('Quantité invalide.', 'error');
    const needsAmount = kind === 'buy' || kind === 'sell' || kind === 'opening-balance';
    if (needsAmount && eur === null) return toasts.push('Montant en € requis.', 'error');
    if (amount.trim() !== '' && eur === null) return toasts.push('Montant invalide.', 'error');
    app.addManual({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: when,
      kind,
      asset: code,
      qty: quantity,
      amountEur: eur,
      scope,
      ...(accountId !== COINHOUSE_ACCOUNT_ID && accountId !== MANUAL_ACCOUNT_ID
        ? { accountId }
        : {}),
      note: note.trim(),
    });
    toasts.push('Opération ajoutée.', 'success');
    qty = '';
    amount = '';
    note = '';
    void app.refreshPrices();
  }
</script>

<AppBar title="Ajouter une opération" back={app.hasData} />

<form class="form" onsubmit={submit}>
  <div class="segmented" role="radiogroup" aria-label="Type d'opération">
    {#each kinds as k (k.value)}
      <button
        type="button"
        role="radio"
        aria-checked={kind === k.value}
        class:active={kind === k.value}
        onclick={() => (kind = k.value)}>{k.label}</button
      >
    {/each}
  </div>
  <label>Date et heure <input type="datetime-local" bind:value={at} required step="1" /></label>
  <label
    >Actif <input
      type="text"
      bind:value={asset}
      list="tickers"
      placeholder="btc, eth, sol…"
      required
      autocapitalize="off"
    /></label
  >
  <datalist id="tickers"
    >{#each Object.keys(TICKERS) as t (t)}<option value={t}>{TICKERS[t]?.name}</option
      >{/each}</datalist
  >
  <label
    >Quantité <input
      type="text"
      inputmode="decimal"
      bind:value={qty}
      placeholder="0,05"
      required
    /></label
  >
  {#if current.amount}
    <label
      >{current.amount}
      <input type="text" inputmode="decimal" bind:value={amount} placeholder="ex. 1500" /></label
    >
    {#if kind === 'buy' || kind === 'sell'}<p class="muted small">
        Le montant réellement vu sur votre compte, pas « prix × quantité » : c'est ainsi que le
        spread et les frais entrent dans le PRU.
      </p>{/if}
  {/if}
  <label
    >Compte
    <select bind:value={accountId}>
      {#each accountOptions as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  </label>
  <label>Note <input type="text" bind:value={note} placeholder="optionnel" /></label>
  <button class="primary" type="submit">Ajouter</button>
</form>

{#if manualList.length > 0}
  <section class="list">
    <h2 class="section">Opérations saisies ({manualList.length})</h2>
    {#each manualList as m (m.id)}
      <p class="line">
        <span
          ><strong>{kinds.find((k) => k.value === m.kind)?.label}</strong>
          <Qty value={D(m.qty)} asset={m.asset} />{#if m.amountEur}
            · {eur(m.amountEur)}{/if}
          <span class="muted small">{fmtDateTime(m.at)}{m.note ? ` · ${m.note}` : ''}</span></span
        ><button
          type="button"
          class="del"
          onclick={() => app.removeManual(m.id)}
          aria-label="Supprimer">✕</button
        >
      </p>
    {/each}
  </section>
{/if}

<style>
  .form {
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-3);
    max-width: 560px;
    margin: 0 auto;
  }
  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px;
  }
  .segmented button {
    min-height: 40px;
    border-radius: 6px;
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .segmented button.active {
    background: var(--accent);
    color: var(--accent-fg);
  }
  label {
    display: grid;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  input,
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    color: var(--fg);
    padding: 0 var(--space-3);
    font-size: var(--fs-md);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .primary {
    min-height: 52px;
    background: var(--accent);
    color: var(--accent-fg);
    border-radius: var(--radius);
    font-weight: 700;
  }
  .list {
    max-width: 560px;
    margin: var(--space-4) auto;
  }
  .section {
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: 0 var(--space-4) var(--space-2);
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
    align-items: center;
  }
  .del {
    min-width: var(--tap);
    min-height: var(--tap);
    color: var(--fg-muted);
  }
</style>
