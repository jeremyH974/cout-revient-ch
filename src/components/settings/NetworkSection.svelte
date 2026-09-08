<script lang="ts">
  /**
   * La sortie réseau, dans la variante personnelle : coupée au démarrage, ouverte seulement si on
   * le demande — **et pour cette session seulement**.
   *
   * ## Pourquoi ce réglage n'est pas enregistré
   *
   * Tous les autres réglages le sont. Celui-ci ne doit pas l'être, et pour la même raison que la
   * clé d'API Anthropic ne l'est pas : ce qu'on enregistre finit par s'appliquer un jour où on n'y
   * pense plus. Un « autoriser le réseau » coché en mars s'appliquerait encore en novembre, à un
   * import qu'on n'avait pas en tête, sans que rien ne le rappelle.
   *
   * En le laissant en mémoire vive, l'état de départ est toujours le même — rien ne sort — et
   * l'ouverture est un geste conscient, daté, qui expire à la fermeture de l'onglet. Le coût est
   * réel : une case à cocher par session où l'on veut des cours. Il est assumé.
   *
   * ## Ce que la case ne peut pas faire
   *
   * Elle lève le verrou applicatif, pas la Content-Security-Policy, qui reste la liste fermée des
   * origines connues (`src/lib/support/csp.ts`) et qu'aucun réglage ne peut élargir. Cocher n'ouvre
   * donc jamais rien de plus que ce que le site public s'autorise déjà.
   */
  import { isLocalOnly, setLocalOnly } from '$lib/net/local-only';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let localOnly = $state(isLocalOnly());

  function toggle(allow: boolean): void {
    setLocalOnly(!allow);
    localOnly = isLocalOnly();
    if (allow) {
      toasts.push('Sortie réseau ouverte pour cette session.');
      void app.refreshPrices();
    } else {
      toasts.push('Sortie réseau coupée : plus rien ne quitte cet appareil.');
    }
  }
</script>

<section class="card group">
  <h2>Sortie réseau</h2>

  {#if localOnly}
    <p class="ok small">
      <strong>Rien ne quitte cet appareil.</strong> Les appels vers les fournisseurs de cours, les explorateurs
      de chaînes et le modèle de langage sont refusés avant d'être émis.
    </p>
  {:else}
    <p class="warn small">
      <strong>La sortie réseau est ouverte</strong> pour cette session. Elle se refermera au prochain
      démarrage.
    </p>
  {/if}

  <label class="check">
    <input type="checkbox" checked={!localOnly} onchange={(e) => toggle(e.currentTarget.checked)} />
    Autoriser les appels sortants pendant cette session
  </label>

  <p class="muted small">
    Sans sortie réseau, l'application ne peut pas coter vos actifs : les montants latents reposent
    alors sur les derniers cours connus ou sur les prix que vous avez saisis. Tout le reste — PRU,
    plus et moins-values réalisées, rapports, exports — se calcule intégralement hors ligne.
  </p>

  <details>
    <summary class="small">Ce que chaque famille d'origines apprendrait de vous</summary>
    <ul class="small">
      <li>
        <strong>Cours et taux</strong> (CoinGecko, Coinbase, Kraken, DefiLlama, Frankfurter) — la
        <em>liste</em> de vos actifs, jamais vos quantités ni vos montants.
      </li>
      <li>
        <strong>Explorateurs de chaînes</strong> (mempool.space, Etherscan, Blockscout, Routescan) —
        vos <strong>adresses publiques</strong>, donc l'intégralité des soldes et de l'historique
        qui y sont attachés. C'est de loin ce qui en dit le plus long sur vous.
      </li>
      <li>
        <strong>Trading</strong> (Hyperliquid) — l'adresse du compte suivi.
      </li>
      <li>
        <strong>Modèle de langage</strong> (Anthropic) — uniquement ce que la feuille de consentement
        vous montre, envoi par envoi, et seulement si vous avez collé votre propre clé.
      </li>
    </ul>
  </details>
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
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap);
    font-size: var(--fs-sm);
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
  ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    display: grid;
    gap: var(--space-2);
    color: var(--fg-muted);
  }
  summary {
    cursor: pointer;
    color: var(--fg-muted);
    min-height: var(--tap);
    display: flex;
    align-items: center;
  }
</style>
