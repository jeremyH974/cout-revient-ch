<script lang="ts">
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';
</script>

<AppBar title="Aide" back={app.hasData} />
<article class="doc">
  <h2>Obtenir votre export Coinhouse</h2>
  <ol>
    <li>Dans l'application Coinhouse, ouvrez l'onglet <strong>Vos transactions</strong>.</li>
    <li>
      Appuyez sur <strong>Exporter</strong>, choisissez <strong>Export avancé</strong>, validez.
    </li>
    <li>
      Coinhouse vous envoie le fichier <code>historique des transactions.csv</code> par e-mail.
      Enregistrez la pièce jointe sur cet appareil, <strong>sans l'ouvrir dans Excel</strong>.
    </li>
    <li>
      Importez-la ici (onglet Importer). Ré-importez un nouvel export quand vous voulez : les
      opérations déjà connues sont ignorées.
    </li>
  </ol>
  <h2>Ce que veulent dire les chiffres</h2>
  <dl>
    <dt>PRU</dt>
    <dd>
      Coût moyen d'une unité que vous détenez, spread et frais inclus (coût moyen pondéré). Il ne
      change que lorsque vous achetez.
    </dd>
    <dt>Investi</dt>
    <dd>
      Quantité détenue × PRU, pour les actifs qui ont un prix. Base du latent. Le coût des actifs
      sans prix est annoncé à part (« hors X € d'actifs sans prix »).
    </dd>
    <dt>Latent</dt>
    <dd>
      Valeur actuelle − investi : ce que vous gagneriez ou perdriez en vendant tout maintenant. Le «
      % vs PRU » rapporte ce latent à l'investi : c'est l'écart du prix au PRU.
    </dd>
    <dt>Réalisé</dt>
    <dd>
      Gains ou pertes déjà encaissés : pour chaque cession (vente, retrait, migration), produit net
      − quantité cédée × PRU du moment.
    </dd>
    <dt>Total</dt>
    <dd>
      Réalisé + latent (+ récompenses valorisées, − abonnements Coinhouse, selon vos réglages).
      C'est le chiffre à regarder. Les actifs sans prix n'y entrent pas.
    </dd>
    <dt>ROI</dt>
    <dd>
      Total ÷ capital maximal engagé, c'est-à-dire le plus d'euros que vous ayez eu investis en même
      temps (apports − retraits au plus haut pour le portefeuille ; achats − produits au plus haut
      pour un actif). Vendre puis racheter n'augmente pas la base, et un euro qui passe par l'USDC
      n'est compté qu'une fois. Contrairement au « % latent », il ne s'effondre pas quand vous
      rachetez.
    </dd>
    <dt>Net investi</dt>
    <dd>
      Somme des achats − somme des ventes : l'argent encore engagé. Négatif ou nul = capital
      récupéré ; aucun pourcentage n'est alors calculé sur cette base.
    </dd>
    <dt>Apports nets (espèces)</dt>
    <dd>
      Euros réellement entrés (achats payés en euros) − euros réellement sortis (ventes encaissées
      en euros). Les échanges crypto ↔ crypto ou via USDC ne comptent pas : aucun euro n'a bougé.
    </dd>
    <dt>Positions clôturées et résidus</dt>
    <dd>
      Une position dont le résidu vaut moins de 0,01 € est classée clôturée ; ce résidu reste
      valorisé et son latent (proche de −coût) compte dans le total, affiché « dont résidus ».
    </dd>
    <dt>Mode discret</dt>
    <dd>
      Masque les montants et les quantités (« •••• »). Les prix, PRU et pourcentages restent
      visibles : ce sont des prix, pas des montants. Le rapport PDF suit la même règle ; les exports
      CSV ne sont jamais masqués.
    </dd>
  </dl>
  <h2>Pourquoi les % de l'app Coinhouse paraissent faux</h2>
  <p>
    Un pourcentage latent se calcule sur le capital engagé : quand vous rachetez au prix du jour, le
    dénominateur grossit et le % chute, sans que vous ayez rien perdu. Regardez le total en euros et
    le ROI.
  </p>
  <h2>Achats payés en USDC</h2>
  <p>
    Un achat payé en USDC est valorisé avec la contre-valeur en euros des USDC dépensés (la colonne
    « Contre-valeur (EUR) » de la ligne crypto est en réalité en USDC dans l'export). Les USDC sont
    suivis comme une ligne à part : leur gain ou perte est l'effet de change euro/dollar.
  </p>
  <h2>Importer d'autres plateformes (Koinly / Waltio)</h2>
  <p>
    Un CSV au format « Koinly Universal » ou l'export interne Koinly (<em
      >Transactions → Bulk edit → Export</em
    >, lu aussi par Waltio) s'importe depuis cet écran, dans un compte dédié à choisir ou à créer.
    Un retrait et un dépôt du même actif entre deux de vos comptes sont appariés automatiquement
    (jusqu'à 72 h d'écart) : le coût d'acquisition voyage vers le dépôt, sans plus-value fantôme ;
    corrigez ou forcez un appariement depuis <strong>Comptes</strong>.
    <strong>Réglages → « Format Koinly / Waltio (CSV) »</strong> exporte à l'inverse toutes vos opérations
    dans ce même format, pour un autre outil.
  </p>
  <h2>Qu'est-ce que l'espace Trading (Hyperliquid) ?</h2>
  <p>
    Un second espace, séparé du PRU : collez une <strong>adresse publique</strong> Hyperliquid
    (jamais de clé) dans l'écran Comptes pour voir l'équité de votre compte, vos positions ouvertes,
    vos avoirs spot et un P&L net (réalisé − frais + funding), avec une réconciliation vérifiée à
    chaque actualisation. Seule l'adresse est envoyée, et uniquement à Hyperliquid (<a
      href={router.href({ name: 'privacy' })}>Confidentialité</a
    >) ; cochez « traiter le spot comme de l'investissement » sur le compte pour que ses achats spot
    comptent aussi dans le PRU.
  </p>
  <h2>Un problème, une idée ?</h2>
  <p>
    Dans <strong>Réglages → Aide et retours</strong>, copiez le diagnostic (il ne contient ni
    montant ni quantité, seulement la version, votre navigateur, les colonnes de votre fichier et
    des compteurs) et collez-le dans un signalement sur GitHub ou dans le Discord. Ne joignez jamais
    votre fichier CSV.
  </p>
  <h2>Limites</h2>
  <p>
    Les récompenses de staking, dépôts et retraits apparaissent dans « À qualifier » si l'export
    utilise un libellé inconnu : le bouton « Qualifier » vous propose le choix le plus probable
    (récompense, dépôt, retrait, mouvement interne à ignorer…) et recalcule aussitôt ; tout reste
    annulable. Le calcul n'est pas la plus-value fiscale française (méthode globale de l'article 150
    VH bis du CGI). <a href={router.href({ name: 'privacy' })}>Confidentialité</a>.
  </p>
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
  ol {
    padding-left: var(--space-4);
  }
  dt {
    font-weight: 700;
    margin-top: var(--space-2);
  }
  dd {
    margin: 0;
    color: var(--fg-muted);
  }
</style>
