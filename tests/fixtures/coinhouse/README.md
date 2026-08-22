# Fixtures Coinhouse

## `export-anonymized.csv`

Dérivé d'un export réel (« Export avancé », interface en français, été 2026) par
`npm run anonymize -- <export.csv>` :

- IDs régénérés par hachage (les deux jambes d'une opération gardent le même ID) ;
- dates décalées d'un nombre de jours constant ;
- quantités, contre-valeurs, frais et remises multipliés par un facteur global ;
- `Prix du marché` conservé (donnée publique) ;
- `Solde` recalculé en reproduisant l'ordre de règlement original, qui diffère parfois de
  l'ordre des horodatages (cas USDC : plusieurs ventes réglées dans un ordre différent la même
  journée).

Le fichier couvre tous les types rencontrés : `Echange` (EUR→crypto, USDC→crypto, crypto→USDC),
`Abonnement` (sans ID, dont une ligne à 0), `Echange Delisting` + `Migration` (MKR → SKY).

Les fixtures `edge-*.csv` sont synthétiques et ciblent un cas chacune.
