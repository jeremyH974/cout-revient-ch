<script lang="ts">
  /**
   * Comptes : le compte Coinhouse (export) et les saisies manuelles existent d'eux-mêmes ; l'utilisateur
   * déclare ici d'autres comptes d'investissement (autre plateforme, wallet) pour y rattacher ses
   * saisies et lire un PRU par plateforme ; et des comptes de trading Hyperliquid (adresse publique,
   * lecture seule : jamais de clé).
   */
  import { D } from '$lib/domain/money';
  import { pairFeeQty } from '$lib/domain/transfers';
  import type { Account } from '$lib/domain/types';
  import { fmtDate, fmtQty } from '$lib/format/fr';
  import { HL_ADDRESS } from '$lib/import/hyperliquid/api-types';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  // --- Virements internes -----------------------------------------------------------------------
  /** Choix de dépôt en attente d'appariement manuel, par id de retrait. */
  let choice = $state<Record<string, string>>({});
  const accountName = (id: string): string => app.accountLabels[id] ?? id;
  const candidatesFor = (asset: string, notAccount: string) =>
    app.transferPairing.unpairedDeposits.filter(
      (d) => d.in.asset === asset && d.accountId !== notAccount,
    );
  function pairManually(withdrawalId: string): void {
    const depositId = choice[withdrawalId];
    if (!depositId) return;
    app.setTransferOverride(withdrawalId, depositId);
    choice = { ...choice, [withdrawalId]: '' };
    toasts.push('Virement apparié : le coût d’acquisition voyage.', 'success');
  }

  let label = $state('');
  let space = $state<Account['space']>('invest');
  let hlAddress = $state('');
  let hlLabel = $state('');
  let hlSpotAsInvestment = $state(false);
  const hlAddressValid = $derived(HL_ADDRESS.test(hlAddress.trim()));
  const KIND_LABELS: Record<Account['kind'], string> = {
    coinhouse: 'Export Coinhouse',
    manual: 'Saisies manuelles',
    hyperliquid: 'Hyperliquid (adresse publique)',
    csv: 'Import CSV',
  };
  const SPACE_LABELS: Record<Account['space'], string> = {
    invest: 'Investissement',
    trading: 'Trading',
  };
  const positionsOf = (id: string): number => {
    const r = app.reportsByAccount.get(id);
    return r ? r.positions.length + r.stablecoins.length : 0;
  };
  const declared = (a: Account): boolean => a.id in app.state.accounts;

  function add(): void {
    const name = label.trim();
    if (name === '')
      return toasts.push('Donnez un nom au compte (ex. « Ledger », « Kraken »).', 'error');
    if (app.accounts.some((a) => a.label.toLowerCase() === name.toLowerCase()))
      return toasts.push('Un compte porte déjà ce nom.', 'error');
    app.addAccount({ label: name, space });
    label = '';
    toasts.push(
      space === 'invest'
        ? 'Compte ajouté : choisissez-le lors de vos prochaines saisies.'
        : 'Compte ajouté : choisissez-le en saisissant vos trades.',
      'success',
    );
  }

  async function addHyperliquid(): Promise<void> {
    const result = app.addHyperliquidAccount({
      address: hlAddress,
      label: hlLabel,
      spotAsInvestment: hlSpotAsInvestment,
    });
    if (!result.ok) return toasts.push(result.error, 'error');
    hlAddress = '';
    hlLabel = '';
    hlSpotAsInvestment = false;
    toasts.push('Compte Hyperliquid ajouté : synchronisation en cours…', 'success');
    await app.syncHyperliquid(result.account.id);
    const status = app.syncStatus[result.account.id];
    if (status?.error) toasts.push(`Synchronisation interrompue : ${status.error}`, 'error');
    else {
      toasts.push(`Synchronisé : ${status?.added ?? 0} élément(s) lus.`, 'success');
      router.navigate({ name: 'trading' });
    }
  }

  function remove(a: Account): void {
    if (!app.removeAccount(a.id)) {
      toasts.push('Ce compte a des saisies : supprimez-les ou rattachez-les avant.', 'error');
      return;
    }
    toasts.push('Compte supprimé.', 'success');
  }
</script>

<AppBar title="Comptes" />

<section class="card">
  <h2>Vos comptes</h2>
  {#if app.accounts.length === 0}
    <p class="muted">
      Aucun compte pour l'instant : importez votre export Coinhouse ou ajoutez une opération, et le
      compte correspondant apparaîtra ici.
    </p>
  {:else}
    <ul class="accounts" aria-label="Comptes">
      {#each app.accounts as a (a.id)}
        <li>
          <div class="main">
            <strong>{a.label}</strong>
            <span class="muted small"
              >{KIND_LABELS[a.kind]} · {SPACE_LABELS[a.space]}{#if a.kind !== 'hyperliquid'}
                · {positionsOf(a.id)} position{positionsOf(a.id) > 1
                  ? 's'
                  : ''}{/if}{#if app.manualCountOf(a.id) > 0}
                · {app.manualCountOf(a.id)} saisie{app.manualCountOf(a.id) > 1
                  ? 's'
                  : ''}{/if}</span
            >
            {#if a.kind === 'hyperliquid'}
              <span class="muted small mono">{a.address}</span>
              <label class="check small"
                ><input
                  type="checkbox"
                  checked={a.spotAsInvestment === true}
                  onchange={(e) => app.setSpotAsInvestment(a.id, e.currentTarget.checked)}
                /> Traiter le spot de ce compte comme de l'investissement (PRU)</label
              >
            {/if}
          </div>
          {#if declared(a)}
            <button
              class="link small"
              type="button"
              onclick={() => remove(a)}
              aria-label="Supprimer le compte {a.label}">Supprimer</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if app.transferPairing.pairs.length > 0 || app.transferPairing.unpairedWithdrawals.length > 0 || app.transferPairing.unpairedDeposits.length > 0}
  <section class="card">
    <h2>Virements internes</h2>
    <p class="muted small">
      Un retrait et un dépôt du même actif entre deux de vos comptes (fenêtre de 72 h, écart ≤ frais
      réseau) sont appariés automatiquement : le coût d'acquisition voyage, aucune plus-value
      fantôme.
    </p>
    {#if app.transferPairing.pairs.length > 0}
      <ul class="transfers">
        {#each app.transferPairing.pairs as pair (pair.withdrawalId)}
          <li>
            <div class="main">
              <strong>{fmtQty(D(pair.qtyOut))} {pair.asset.toUpperCase()}</strong>
              <span class="muted small"
                >{accountName(pair.fromAccountId)} → {accountName(pair.toAccountId)} ·
                {fmtDate(pair.at)}{#if pairFeeQty(pair).gt(D('0'))}
                  · frais réseau {fmtQty(pairFeeQty(pair))}
                  {pair.asset.toUpperCase()}{/if}{#if pair.forced}
                  · apparié manuellement{/if}</span
              >
            </div>
            <button
              class="linkish"
              type="button"
              onclick={() => app.setTransferOverride(pair.withdrawalId, 'none')}>Délier</button
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#each app.transferPairing.unpairedWithdrawals as w (w.id)}
      <div class="pairline">
        <div class="main">
          <strong
            >{fmtQty(D(w.out.qty))} {w.out.asset.toUpperCase()} retirés sans contrepartie</strong
          >
          <span class="muted small">{accountName(w.accountId)} · {fmtDate(w.at)}</span>
        </div>
        {#if app.state.transferOverrides[w.id] === 'none'}
          <button class="linkish" type="button" onclick={() => app.setTransferOverride(w.id, null)}
            >Réactiver l'appariement automatique</button
          >
        {:else if candidatesFor(w.out.asset, w.accountId).length > 0}
          <label class="pairpick">
            <span class="sr-only">Dépôt à apparier</span>
            <select bind:value={choice[w.id]}>
              <option value="">Apparier avec…</option>
              {#each candidatesFor(w.out.asset, w.accountId) as d (d.id)}
                <option value={d.id}
                  >{fmtQty(D(d.in.qty))}
                  {d.in.asset.toUpperCase()} · {accountName(d.accountId)} ·
                  {fmtDate(d.at)}</option
                >
              {/each}
            </select>
          </label>
          <button
            class="linkish"
            type="button"
            disabled={!choice[w.id]}
            onclick={() => pairManually(w.id)}>Apparier</button
          >
        {:else}
          <span class="muted small">Renseignez sa valeur, ou laissez la sortie au coût.</span>
        {/if}
      </div>
    {/each}
    {#if app.transferPairing.unpairedDeposits.length > 0}
      <p class="muted small">
        {app.transferPairing.unpairedDeposits.length} dépôt(s) sans retrait correspondant : coût d'acquisition
        0 € tant qu'ils ne sont ni appariés ni qualifiés.
      </p>
    {/if}
  </section>
{/if}

<section class="card">
  <h2>Ajouter un compte manuel</h2>
  <p class="muted small">
    Une autre plateforme, un wallet : en <strong>Investissement</strong>, vous y rattachez vos
    saisies et lisez un PRU par compte ; en <strong>Trading</strong>, vous y rattachez vos trades
    saisis à la main.
  </p>
  <form
    class="add"
    onsubmit={(e) => {
      e.preventDefault();
      add();
    }}
  >
    <label class="field"
      >Nom du compte
      <input
        type="text"
        bind:value={label}
        placeholder="ex. Ledger, Kraken, Binance"
        maxlength="60"
      />
    </label>
    <label class="field"
      >Espace
      <select bind:value={space}>
        <option value="invest">Investissement (PRU)</option>
        <option value="trading">Trading (trades manuels)</option>
      </select>
    </label>
    <button class="primary" type="submit">Ajouter</button>
  </form>
</section>

<section class="card trading">
  <h2>Ajouter un compte Hyperliquid</h2>
  <p class="muted small">
    Lecture seule : collez l'adresse publique de votre compte (celle de votre wallet, <code
      >0x…</code
    >). Aucune clé, aucune signature ; l'adresse n'est envoyée qu'à <code>api.hyperliquid.xyz</code>
    et reste dans votre navigateur. Les fills, le funding, les dépôts et retraits alimentent l'espace
    <a href={router.href({ name: 'trading' })}>Trading</a>.
  </p>
  <form
    class="add"
    onsubmit={(e) => {
      e.preventDefault();
      void addHyperliquid();
    }}
  >
    <label class="field"
      >Adresse publique
      <input
        type="text"
        bind:value={hlAddress}
        placeholder="0x… (40 caractères hexadécimaux)"
        autocomplete="off"
        spellcheck="false"
        inputmode="text"
        maxlength="42"
        aria-invalid={hlAddress.trim() !== '' && !hlAddressValid}
      />
    </label>
    <label class="field"
      >Nom (facultatif)
      <input
        type="text"
        bind:value={hlLabel}
        placeholder="ex. Hyperliquid principal"
        maxlength="60"
      />
    </label>
    <label class="check"
      ><input type="checkbox" bind:checked={hlSpotAsInvestment} /> Traiter le spot de ce compte comme
      de l'investissement (PRU et plus-values dans l'espace Investissement)</label
    >
    <button class="primary" type="submit" disabled={!hlAddressValid}>Ajouter et synchroniser</button
    >
  </form>
</section>

<style>
  .accounts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .accounts li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap);
    padding: var(--space-2) 0;
  }
  .accounts li + li {
    border-top: 1px solid var(--border);
  }
  .main {
    display: grid;
    gap: 2px;
  }
  .add {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-height: var(--tap);
  }
  .check input {
    margin-top: 4px;
  }
  .mono {
    font-family: var(--font-mono);
    word-break: break-all;
  }
  .transfers {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .transfers li,
  .pairline {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-height: var(--tap);
    padding: var(--space-2) 0;
  }
  .transfers li + li,
  .pairline {
    border-top: 1px solid var(--border);
  }
  .linkish {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--fg);
    min-height: var(--tap);
    padding: 0 var(--space-3);
    cursor: pointer;
  }
  .linkish:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .pairpick select {
    min-height: var(--tap);
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-2);
  }
  .trading {
    border-left: 4px solid var(--accent-trading);
  }
  .trading .add {
    grid-template-columns: 1fr;
  }
  input[aria-invalid='true'] {
    border-color: var(--loss);
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
    .add {
      grid-template-columns: 1fr auto auto;
      align-items: end;
    }
  }
</style>
