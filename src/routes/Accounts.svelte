<script lang="ts">
  /**
   * Comptes : le compte Coinhouse (export) et les saisies manuelles existent d'eux-mêmes ; l'utilisateur
   * déclare ici d'autres comptes d'investissement (autre plateforme, wallet) pour y rattacher ses
   * saisies et lire un PRU par plateforme ; et des comptes de trading Hyperliquid (adresse publique,
   * lecture seule : jamais de clé).
   */
  import type { Account } from '$lib/domain/types';
  import { HL_ADDRESS } from '$lib/import/hyperliquid/api-types';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

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
