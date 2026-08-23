# Fixtures Coinhouse

## `export-demo.csv` — jeu de démonstration synthétique

Généré par `npm run fixture` (`scripts/generate-fixture.ts`), **jamais dérivé d'un export réel** :
le portefeuille, ses montants, ses dates et ses proportions sont inventés par un générateur
déterministe (graine fixe), seuls des niveaux de cours publics approximatifs servent de points
d'ancrage pour que les prix d'achat restent plausibles. Le fichier commis doit être identique à la
sortie du script (`tests/integration/demo-fixture.test.ts`) : pour le modifier, éditez le scénario
du générateur puis relancez `npm run fixture`.

Il sert à la fois de fixture de tests et de données d'exemple dans l'application (bouton « Essayer
avec des données d'exemple »). Il reproduit le format « Export avancé » (interface FR, été 2026) et
couvre tout ce que l'importeur sait traiter :

- `Echange` en deux jambes de même ID : achats en euros, achats d'USDC, achats payés en USDC,
  ventes vers euros et vers USDC, DCA, vente puis rachat (PRU invariant), positions clôturées en
  gain et en perte, actif à prix minuscule (PEPE) ;
- frais bruts + remise d'abonnement (partielle, totale ou nulle) sur la jambe contrepartie,
  `Prix du marché` de la jambe actif exprimé dans la devise de contrepartie ;
- `Abonnement` (sans ID, dont une ligne à 0), `Echange Delisting` + `Migration` (MKR → SKY) ;
- `Solde` après chaque opération, avec une journée où deux opérations USDC sont réglées dans
  l'ordre inverse de leurs horodatages (cas observé sur de vrais exports).
