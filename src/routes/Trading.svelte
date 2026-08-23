<script lang="ts">
  /** Espace Trading : état vide tant que l'import Hyperliquid (P20) et le journal (P21) ne sont pas livrés. */
  import { DISCUSSIONS_URL } from '$lib/support/links';
  import AppBar from '../components/layout/AppBar.svelte';
</script>

<AppBar title="Trading" />

<section class="card empty">
  <h2>Vos trades, bientôt ici</h2>
  <p>
    Cet espace est séparé de l'investissement : un trade se lit en aller-retour (entrée → sortie),
    avec un P&L net de frais et de funding, un résultat en R, une note « pourquoi j'ai pris ce trade
    » et des statistiques par setup — jamais un PRU.
  </p>
  <ul>
    <li>
      <strong>Hyperliquid en lecture seule</strong> : vous collerez votre adresse publique ; aucune clé,
      rien ne quitte votre navigateur.
    </li>
    <li><strong>Saisie manuelle</strong> d'un trade en quelques secondes, depuis le téléphone.</li>
    <li>
      <strong>Journal et statistiques</strong> : espérance, taux de réussite, profit factor, drawdown,
      calendrier, avec un garde-fou tant que l'échantillon est trop petit.
    </li>
  </ul>
  <p class="small muted">
    Avancement et retours :
    <a href={DISCUSSIONS_URL} target="_blank" rel="noopener noreferrer">discussions du projet</a>.
  </p>
</section>

<style>
  .empty {
    border-left: 4px solid var(--accent-trading);
    display: grid;
    gap: var(--space-3);
  }
  .empty h2 {
    margin: 0;
  }
  ul {
    display: grid;
    gap: var(--space-2);
    padding-left: 1.2em;
    margin: 0;
  }
</style>
