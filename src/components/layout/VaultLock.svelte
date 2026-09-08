<script lang="ts">
  /**
   * La porte du coffre. Affichée **à la place** de toute l'application quand des données chiffrées
   * existent et qu'aucune clé n'est ouverte.
   *
   * « À la place » n'est pas une question de mise en page : tant que cet écran est là, `app.init()`
   * n'a rien chargé, aucun effet de sauvegarde n'est installé et aucun écouteur n'écoute. Il n'y a
   * donc rien à masquer — il n'y a rien.
   *
   * Deux choix d'affichage volontaires :
   *
   * - **Aucun compteur de tentatives, aucun délai croissant.** Ce serait du théâtre : les données
   *   sont sur le disque de celui qui les attaque, il ne passera pas par cet écran. Le vrai coût
   *   d'une tentative, c'est Argon2id — 46 Mio de mémoire à chaque essai, y compris hors ligne.
   * - **Le message d'échec ne distingue pas** « mauvais mot de passe » de « données altérées ». La
   *   cryptographie ne les distingue pas non plus, et l'utilisateur n'a de toute façon qu'une
   *   action possible.
   */
  import { app } from '../../state/app.svelte';

  let passphrase = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let progress = $state(0);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || passphrase === '') return;
    busy = true;
    error = null;
    progress = 0;
    try {
      await app.unlockVaultWith(passphrase, (fraction) => (progress = fraction));
      passphrase = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      // Le champ est vidé : réessayer part d'une page blanche, pas d'une saisie à corriger.
      passphrase = '';
    } finally {
      busy = false;
    }
  }
</script>

<main class="lock">
  <section class="card">
    <h1>Vos données sont chiffrées</h1>
    <p class="muted">
      Cet appareil garde vos opérations sous un mot de passe. Rien n'a été chargé tant qu'il n'est
      pas saisi.
    </p>

    <form onsubmit={submit}>
      <label class="field" for="vault-passphrase">Mot de passe</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="vault-passphrase"
        type="password"
        autocomplete="current-password"
        autocapitalize="off"
        spellcheck={false}
        autofocus
        bind:value={passphrase}
        disabled={busy}
        aria-describedby="vault-help"
      />

      <button class="primary" type="submit" disabled={busy || passphrase === ''}>
        {busy ? 'Ouverture…' : 'Ouvrir'}
      </button>

      {#if busy}
        <p class="muted small" role="status">
          Dérivation de la clé{progress > 0 ? ` — ${Math.round(progress * 100)} %` : '…'}
        </p>
      {/if}

      <p class="error" role="alert">{error ?? ''}</p>
    </form>

    <p id="vault-help" class="muted small">
      Ce mot de passe n'est enregistré nulle part et ne quitte pas cet appareil. Personne — pas même
      cette application — ne peut le retrouver ni le réinitialiser : le perdre revient à perdre les
      données. Si vous avez une sauvegarde chiffrée, elle reste votre seul recours.
    </p>
  </section>
</main>

<style>
  .lock {
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: var(--space-3);
  }
  .card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    max-width: 30rem;
    width: 100%;
  }
  h1 {
    font-size: var(--fs-lg);
    margin: 0;
  }
  p {
    margin: 0;
  }
  form {
    display: grid;
    gap: var(--space-2);
  }
  .field {
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
  .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .small {
    font-size: var(--fs-xs);
  }
  /*
   * Réservé en permanence, même vide : sans cela, l'apparition du message pousserait le bouton
   * sous le doigt au moment exact où l'on s'apprête à réessayer.
   */
  .error {
    color: var(--loss);
    font-size: var(--fs-sm);
    min-height: 1.4em;
  }
</style>
