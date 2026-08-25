<script lang="ts">
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
</script>

<AppBar title="Confidentialité" back={app.hasData} />
<article class="doc">
  <h2>Où sont vos données ?</h2>
  <p>
    Uniquement dans ce navigateur, sur cet appareil (stockage local du navigateur : IndexedDB, avec
    une copie de secours). Aucun serveur ne les reçoit : l'application est un simple site statique.
    Vider les données de navigation ou changer d'appareil les efface — d'où la sauvegarde JSON
    proposée dans les réglages. Si vous choisissez un dossier de sauvegarde automatique (Chrome,
    Edge), le fichier est écrit sur votre disque, par votre navigateur, sans passer par un serveur ;
    si vous chiffrez une sauvegarde, la phrase secrète n'est jamais enregistrée : perdue, la
    sauvegarde est illisible.
  </p>
  <h2>Qu'est-ce qui sort de votre appareil ?</h2>
  <ul>
    <li>
      La liste des cryptos que vous détenez (pas les quantités), envoyée à CoinGecko puis Coinbase
      pour obtenir les prix. Ces services voient votre adresse IP. Désactivable dans les réglages
      (prix manuels).
    </li>
    <li>Le téléchargement du site lui-même depuis GitHub Pages (qui voit votre adresse IP).</li>
    <li>
      Si vous suivez un compte Hyperliquid (espace Trading), son <strong>adresse publique</strong>
      (jamais de clé) : envoyée uniquement à <code>api.hyperliquid.xyz</code> pour lire vos fills, positions
      et soldes, et stockée seulement sur cet appareil, jamais ailleurs.
    </li>
    <li>
      Si vous suivez une adresse on-chain (espace Investissement), elle n'est envoyée qu'à l'API de
      sa <strong>propre chaîne</strong> — <code>mempool.space</code> pour une adresse Bitcoin,
      <code>eth.blockscout.com</code>, <code>arbitrum.blockscout.com</code> ou
      <code>base.blockscout.com</code> pour une adresse Ethereum, Arbitrum One ou Base — jamais aux trois
      autres, et stockée seulement sur cet appareil.
    </li>
    <li>
      Si vous suivez un portefeuille Bitcoin par sa <strong>clé publique étendue</strong> (xpub,
      ypub, zpub), cette clé <strong>ne quitte jamais votre navigateur</strong> : elle y est dérivée
      localement, et seules les adresses individuelles qui en sortent sont interrogées. C'est
      délibéré — confier un xpub à un service tiers lui donnerait la vue permanente de tout le
      portefeuille, passé et à venir. Une clé <strong>privée</strong> étendue est refusée à la saisie
      et n'est jamais enregistrée.
    </li>
    <li>
      Si vous activez « Prix en direct » sur l'écran Trading, un flux de cours de marché s'ouvre
      vers
      <code>wss://api.hyperliquid.xyz</code> ; <strong>aucune adresse n'y transite</strong> — c'est un
      flux public identique pour tout le monde.
    </li>
    <li>
      « Trades en direct » est différent et doit être dit clairement : ce flux
      <strong>envoie votre adresse publique</strong> à <code>wss://api.hyperliquid.xyz</code> pour
      que la plateforme sache quelles exécutions vous pousser — exactement la même adresse que celle
      déjà envoyée à chaque synchronisation, à la même destination et à personne d'autre. Les deux
      flux sont <strong>décochés par défaut</strong>, ne s'ouvrent jamais sans votre clic, et se
      coupent dès que l'onglet passe en arrière-plan.
    </li>
    <li>
      Si vous activez la <strong>veille des alertes de prix</strong> (décochée par défaut), l'app
      interroge les mêmes fournisseurs de prix que le bouton « Actualiser », simplement plus souvent
      (cadence choisie, 1 à 15 min), et seulement quand elle est ouverte. Sur Chrome/Edge avec l'app
      installée et les notifications activées, le navigateur peut en plus réveiller de temps en
      temps une vérification <strong>app fermée</strong> : elle envoie la même requête de prix
      (identifiants d'actifs uniquement), rien de plus. Vos
      <strong>seuils d'alerte et votre PRU ne sortent jamais</strong> de l'appareil : la comparaison se
      fait localement, et les notifications sont générées par votre navigateur — aucun serveur de notification
      n'existe.
    </li>
  </ul>
  <p>Pas de compte, pas de cookies, pas de statistiques, pas de publicité.</p>
  <p>
    Le diagnostic copiable proposé dans les réglages (pour signaler un problème) ne contient ni
    montant ni quantité : seulement la version, votre navigateur, les colonnes de votre fichier et
    des compteurs. Il ne part que si vous le collez vous-même quelque part.
  </p>
  <h2>Tout effacer</h2>
  <p>Réglages → Zone dangereuse → Effacer toutes les données.</p>
  <h2>Avertissement</h2>
  <p>
    Outil indépendant, non affilié à Coinhouse. Les indicateurs affichés sont des aides à la
    gestion, ni conseil en investissement ni calcul fiscal. Code source sous licence MIT sur GitHub.
  </p>
  <p class="muted">Version {__APP_VERSION__}</p>
</article>

<style>
  .doc {
    padding: var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    font-size: var(--fs-sm);
    line-height: 1.55;
  }
  h2 {
    margin: var(--space-4) 0 var(--space-2);
  }
  ul {
    padding-left: var(--space-4);
  }
</style>
