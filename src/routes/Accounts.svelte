<script lang="ts">
  /**
   * Comptes : le compte Coinhouse (export) et les saisies manuelles existent d'eux-mêmes ; l'utilisateur
   * déclare ici d'autres comptes d'investissement (autre plateforme, wallet) pour y rattacher ses
   * saisies et lire un PRU par plateforme. Les comptes de trading (Hyperliquid) arriveront avec P20.
   */
  import type { Account } from '$lib/domain/types';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  let label = $state('');
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
    app.addAccount({ label: name, space: 'invest' });
    label = '';
    toasts.push('Compte ajouté : choisissez-le lors de vos prochaines saisies.', 'success');
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
              >{KIND_LABELS[a.kind]} · {SPACE_LABELS[a.space]} · {positionsOf(a.id)} position{positionsOf(
                a.id,
              ) > 1
                ? 's'
                : ''}{#if app.manualCountOf(a.id) > 0}
                · {app.manualCountOf(a.id)} saisie{app.manualCountOf(a.id) > 1
                  ? 's'
                  : ''}{/if}</span
            >
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
  <h2>Ajouter un compte d'investissement</h2>
  <p class="muted small">
    Une autre plateforme, un wallet, un livret : vous y rattachez vos saisies manuelles et l'espace
    Investissement vous montre le PRU de chaque compte en plus du PRU consolidé.
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
    <button class="primary" type="submit">Ajouter</button>
  </form>
  <p class="muted small">
    Comptes de trading (Hyperliquid, adresse publique en lecture seule) : à venir dans l'espace
    <a href={router.href({ name: 'trading' })}>Trading</a>.
  </p>
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
      grid-template-columns: 1fr auto;
      align-items: end;
    }
  }
</style>
