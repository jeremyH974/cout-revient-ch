<script lang="ts">
  import { router } from '$lib/router.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  let loadingDemo = $state(false);

  async function tryDemo(): Promise<void> {
    loadingDemo = true;
    try {
      const result = await app.loadDemo();
      if (!result.ok) return toasts.push(result.error, 'error');
      toasts.push('Données d’exemple chargées : tout est fictif.', 'info');
      router.navigate({ name: 'portfolio' });
      void app.refreshPrices();
    } catch {
      toasts.push('Impossible de charger les données d’exemple.', 'error');
    } finally {
      loadingDemo = false;
    }
  }
</script>

<div class="welcome">
  <header>
    <p class="kicker">Gratuit · sans compte · 100 % dans votre navigateur</p>
    <h1>Votre PRU par crypto, enfin lisible.</h1>
    <p class="lead">
      Importez votre export Coinhouse : prix de revient tenant compte des ventes (spread et frais
      inclus), plus-values réalisées et latentes, ligne par ligne et au total.
    </p>
  </header>

  <ol class="steps">
    <li>
      <h2>1. Dans l'app Coinhouse</h2>
      <p>
        Onglet <strong>Vos transactions</strong> → <strong>Exporter</strong> →
        <strong>Export avancé</strong> → valider.
      </p>
    </li>
    <li>
      <h2>2. Coinhouse vous envoie le fichier par e-mail</h2>
      <p>
        Ouvrez cet e-mail <strong>sur cet appareil</strong> et enregistrez la pièce jointe (<code
          >historique des transactions.csv</code
        >). Sur iPhone : appui long → <em>Enregistrer dans Fichiers</em>.
      </p>
      <p class="warn">
        N'ouvrez pas le fichier dans Excel avant de l'importer : il en modifie les nombres et les
        dates.
      </p>
    </li>
    <li>
      <h2>3. Importez-le ici</h2>
      <p>
        Le fichier reste dans votre navigateur. Rien n'est envoyé nulle part — seuls les noms des
        cryptos sont demandés à CoinGecko/Coinbase pour afficher les prix.
      </p>
    </li>
  </ol>

  <div class="actions">
    <a class="primary" href={router.href({ name: 'import' })}>Importer mon export CSV</a>
    <a class="secondary" href={router.href({ name: 'add' })}>Saisir mes opérations à la main</a>
    <button class="secondary" type="button" disabled={loadingDemo} onclick={() => void tryDemo()}
      >{loadingDemo ? 'Chargement…' : 'Essayer avec des données d’exemple'}</button
    >
  </div>

  <p class="legal muted">
    Outil indépendant, non affilié à Coinhouse. Indicateurs de gestion : ni conseil en
    investissement, ni calcul fiscal (la plus-value imposable en France suit la méthode globale de
    l'article 150 VH bis du CGI). <a href={router.href({ name: 'privacy' })}>Confidentialité</a> ·
    <a href={router.href({ name: 'help' })}>Aide</a>
  </p>
</div>

<style>
  .welcome {
    padding: var(--space-6) var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    display: grid;
    gap: var(--space-5);
  }
  .kicker {
    color: var(--accent);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }
  h1 {
    margin-top: var(--space-2);
  }
  .lead {
    margin-top: var(--space-3);
    color: var(--fg-muted);
  }
  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-3);
  }
  .steps li {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-4);
  }
  .steps p {
    margin-top: var(--space-1);
    font-size: var(--fs-sm);
  }
  .warn {
    color: var(--warn);
  }
  .actions {
    display: grid;
    gap: var(--space-2);
  }
  .primary,
  .secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    border-radius: var(--radius);
    font-weight: 700;
    text-decoration: none;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .secondary {
    border: 1px solid var(--border);
    color: var(--fg);
    background: transparent;
    cursor: pointer;
    font-size: inherit;
    width: 100%;
  }
  .secondary:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .legal {
    font-size: var(--fs-xs);
  }
</style>
