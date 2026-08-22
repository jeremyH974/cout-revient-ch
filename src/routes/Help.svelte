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
    <dd>Quantité détenue × PRU. Base du latent.</dd>
    <dt>Latent</dt>
    <dd>
      Valeur actuelle − investi : ce que vous gagneriez ou perdriez en vendant tout maintenant.
    </dd>
    <dt>Réalisé</dt>
    <dd>
      Gains ou pertes déjà encaissés : pour chaque vente, produit net − quantité vendue × PRU du
      moment.
    </dd>
    <dt>Total</dt>
    <dd>Réalisé + latent. C'est le chiffre à regarder.</dd>
    <dt>ROI</dt>
    <dd>
      Total ÷ somme de tous vos achats. Contrairement au « % latent », il ne s'effondre pas quand
      vous rachetez.
    </dd>
    <dt>Net investi</dt>
    <dd>
      Somme des achats − somme des ventes : l'argent encore engagé. Négatif = capital récupéré.
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
  <h2>Limites</h2>
  <p>
    Les récompenses de staking, dépôts et retraits apparaissent dans « À qualifier » si l'export
    utilise un libellé inconnu. Le calcul n'est pas la plus-value fiscale française (méthode globale
    de l'article 150 VH bis du CGI). <a href={router.href({ name: 'privacy' })}>Confidentialité</a>.
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
