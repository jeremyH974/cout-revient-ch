<script lang="ts">
  /**
   * Gestion du coffre : l'installer, changer son mot de passe, verrouiller, le retirer.
   *
   * Le point délicat n'est pas l'interface, c'est **l'ordre**. Installer le coffre réécrit tout
   * l'état chiffré par-dessus les copies en clair ; si cette réécriture échoue, `installVault`
   * défait l'installation plutôt que de laisser un coffre posé sur des données restées lisibles.
   * L'écran se contente de rapporter ce qui s'est passé.
   *
   * L'insistance sur la sauvegarde préalable n'est pas une formalité : c'est le seul recours qui
   * existe. Aucun compte, aucun service, aucune question secrète ne peut rouvrir ce coffre.
   */
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let mode = $state<'idle' | 'install' | 'change' | 'remove'>('idle');
  let busy = $state(false);
  let current = $state('');
  let next = $state('');
  let confirm = $state('');

  const MIN = 12;
  const tooShort = $derived(next.length > 0 && next.length < MIN);
  const mismatch = $derived(confirm.length > 0 && next !== confirm);

  function reset(): void {
    mode = 'idle';
    current = '';
    next = '';
    confirm = '';
  }

  async function run(what: () => Promise<void>, done: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await what();
      toasts.push(done, 'success');
      reset();
    } catch (error) {
      toasts.push(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="card group">
  <h2>Coffre : chiffrer les données de cet appareil</h2>

  {#if app.vaultInstalled}
    <p class="muted small">
      <strong class="ok">Le coffre est installé.</strong> Vos opérations sont chiffrées dans le stockage
      de ce navigateur, et l'application demande le mot de passe à chaque ouverture.
    </p>
  {:else}
    <p class="muted small">
      Sans coffre, vos opérations sont enregistrées <strong>en clair</strong> dans le stockage de ce navigateur
      : un profil copié, un disque non chiffré ou une extension qui lit ce site suffisent à les relire.
      Le coffre les chiffre au repos, avec une clé dérivée de votre mot de passe (Argon2id + AES-GCM),
      qui ne quitte jamais cet appareil.
    </p>
    <p class="warn small">
      <strong>Faites d'abord une sauvegarde chiffrée.</strong> Un mot de passe perdu n'est pas récupérable
      : il n'existe ni compte, ni service, ni question secrète capable de rouvrir ce coffre.
    </p>
  {/if}

  {#if mode === 'idle'}
    <div class="row">
      {#if app.vaultInstalled}
        <button class="secondary" type="button" onclick={() => (mode = 'change')}>
          Changer le mot de passe
        </button>
        <button class="secondary" type="button" onclick={() => app.lockVault()}>
          Verrouiller maintenant
        </button>
        <button class="secondary danger" type="button" onclick={() => (mode = 'remove')}>
          Retirer le coffre
        </button>
      {:else}
        <button class="primary" type="button" onclick={() => (mode = 'install')}>
          Installer le coffre
        </button>
      {/if}
    </div>
  {/if}

  {#if mode === 'install' || mode === 'change'}
    <div class="fields">
      {#if mode === 'change'}
        <label class="field">
          Mot de passe actuel
          <input type="password" autocomplete="current-password" bind:value={current} />
        </label>
      {/if}
      <label class="field">
        Nouveau mot de passe
        <input type="password" autocomplete="new-password" bind:value={next} />
      </label>
      <label class="field">
        Répéter le nouveau mot de passe
        <input type="password" autocomplete="new-password" bind:value={confirm} />
      </label>
      <p class="muted small" role="status">
        {#if tooShort}
          Au moins {MIN} caractères. Une phrase entière vaut mieux qu'un mot compliqué.
        {:else if mismatch}
          Les deux saisies diffèrent.
        {:else}
          Une phrase que vous seul retenez, d'au moins {MIN} caractères.
        {/if}
      </p>
      <div class="row">
        <button
          class="primary"
          type="button"
          disabled={busy ||
            next.length < MIN ||
            next !== confirm ||
            (mode === 'change' && !current)}
          onclick={() =>
            run(
              mode === 'install'
                ? () => app.installVault(next)
                : () => app.changeVaultPassphrase(current, next),
              mode === 'install' ? 'Coffre installé, données chiffrées.' : 'Mot de passe changé.',
            )}
        >
          {busy ? 'En cours…' : mode === 'install' ? 'Installer et chiffrer' : 'Changer'}
        </button>
        <button class="secondary" type="button" onclick={reset} disabled={busy}>Annuler</button>
      </div>
    </div>
  {/if}

  {#if mode === 'remove'}
    <div class="fields">
      <p class="warn small">
        Retirer le coffre réécrit vos opérations <strong>en clair</strong> dans ce navigateur. À ne faire
        que si vous savez pourquoi.
      </p>
      <label class="field">
        Mot de passe actuel
        <input type="password" autocomplete="current-password" bind:value={current} />
      </label>
      <div class="row">
        <button
          class="primary danger"
          type="button"
          disabled={busy || current === ''}
          onclick={() =>
            run(() => app.removeVault(current), 'Coffre retiré : les données sont en clair.')}
        >
          {busy ? 'En cours…' : 'Retirer le coffre'}
        </button>
        <button class="secondary" type="button" onclick={reset} disabled={busy}>Annuler</button>
      </div>
    </div>
  {/if}

  <p class="muted small">
    Le coffre protège les données <em>au repos</em> — c'est-à-dire quand l'application est fermée. Il
    ne protège pas un écran déjà déverrouillé : à ce moment-là, vos données sont en mémoire, en clair,
    par nécessité.
  </p>
</section>

<style>
  .group {
    padding: var(--space-4);
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
  .fields {
    display: grid;
    gap: var(--space-2);
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  input {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
    width: 100%;
    min-width: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-weight: 700;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .primary.danger {
    background: var(--loss);
    color: #fff;
  }
  .secondary {
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .secondary.danger {
    color: var(--loss);
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  .ok {
    color: var(--gain);
  }
</style>
