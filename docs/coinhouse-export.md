# Export Coinhouse — format et sémantique (vérifiés sur un export réel, été 2026)

Obtention : app Coinhouse → onglet **Vos transactions** → **Exporter** → **Export avancé** →
fichier `historique des transactions.csv` envoyé **par e-mail**.

## Fichier

```
ID Coinhouse,Date,Type,Quantité,Devise,Prix du marché,Contre-valeur (EUR),Frais (devise),Frais Contre-valeur (EUR),Remise frais,Solde,Compte
```

- Délimiteur virgule, décimales avec point, UTF-8 sans BOM, fins de ligne LF.
- Trié du plus récent au plus ancien. Dates `dd/MM/yyyy HH:mm:ss`.
- `Devise` en minuscules (`btc`, `eth`, `usdc`, `eur`, `sky`…).
- Quantités jusqu'à 9 décimales, contre-valeurs jusqu'à 21 décimales → arithmétique décimale
  exacte obligatoire (big.js), jamais de `number`.
- `Compte` vaut `Portefeuille` pour les cryptos et `""` (guillemets littéraux) pour `eur`.

## Types observés

| Type                | Lignes                                                                                                       | Sens                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `Echange`           | **2 lignes par opération, même `ID Coinhouse`** : une jambe actif + une jambe contrepartie (`eur` ou `usdc`) | achat, vente, achat payé en USDC, vente vers USDC |
| `Abonnement`        | 1 ligne, sans ID, en `eur`, quantité positive (parfois `0.0`)                                                | coût d'abonnement Coinhouse — hors PRU            |
| `Echange Delisting` | 1 ligne, quantité négative, `Solde` = 0                                                                      | sortie d'un actif retiré (ex. MKR)                |
| `Migration`         | 1 ligne, quantité positive, le même jour                                                                     | entrée de l'actif de remplacement (ex. SKY)       |

Toute autre ligne isolée (1 ligne, ni `Abonnement` ni `Echange Delisting` ni `Migration`) est une
opération **simple** : son libellé (`Type`) est cherché dans une table extensible
(`src/lib/import/coinhouse/row-types.ts`) qui décide comment l'interpréter.

## Libellés des opérations simples (`row-types.ts`)

Deux catégories, jamais mélangées :

- **`auto`** — libellé confirmé par l'usage (présent depuis la V1) : interprété tout seul à
  l'import, avec un avertissement rappelant que c'est fait par heuristique.
  `Récompense`/`Reward`/`Rendement`/`Intérêts` → récompense (coût 0 € par défaut) ;
  `Dépôt`/`Deposit`/`Réception` → dépôt (coût à saisir) ; `Retrait`/`Withdrawal`/`Envoi` → retrait.
- **`suggest` — non confirmés, Coinhouse 2026** : libellés probables des fonctions annoncées par
  Coinhouse entre juin et août 2026 (staking flexible, produits de rendement, retraits de staking,
  parrainage…) mais jamais vus sur un export réel. La ligne reste **à qualifier** ; l'écran
  pré-sélectionne seulement le choix le plus probable d'après le libellé et le signe de la
  quantité (ex. « Staking » seul → « Ignorer » ; un libellé contenant « récompense » sur une
  jambe positive → « Récompense »). Rien n'est jamais appliqué sans confirmation explicite.

Un libellé qui ne correspond à aucune entrée exacte est aussi comparé à des familles de mots (ex.
tout ce qui contient « staking » → probablement un mouvement interne) ; ce filet de sécurité reste
toujours en mode `suggest`, jamais `auto`.

**Promouvoir un libellé confirmé** : dès qu'un export réel confirme un libellé `suggest` (ex.
« Récompense de staking SOL » vu tel quel sur un export), il suffit de lui ajouter une entrée dans
`ROW_TYPE_HINTS` avec `mode: 'auto'` — une seule ligne dans
`src/lib/import/coinhouse/row-types.ts`, jamais ailleurs, et sans toucher au comportement des
libellés encore incertains.

## Fichier qui n'est pas le bon export

Un fichier qui a les colonnes `Date`/`Type`/`Quantité`/`Devise` mais pas `Contre-valeur (EUR)` est
presque sûrement l'**Export basique** de Coinhouse (filtré, inexploitable pour un coût de revient) :
l'import le refuse et indique comment récupérer l'**Export avancé** à la place (app Coinhouse →
Vos transactions → Exporter → Export avancé).

## Sémantique des colonnes (règle d'or)

Sur la **jambe contrepartie** (`eur` / `usdc`) :

- `Prix du marché` = taux EUR de la contrepartie (1 pour `eur`, ≈ 0,85–0,89 pour `usdc`) ;
- `Contre-valeur (EUR)` = **vraie valeur EUR** du montant brut (achat : débité frais inclus ;
  vente : reçu net de frais) ;
- `Frais (devise)` = frais bruts, `Remise frais` = remise dans la même devise ;
  **frais effectif = Frais − Remise**, déjà net dans la quantité.

Sur la **jambe actif** :

- `Prix du marché` est exprimé **dans la devise de contrepartie** (EUR si payé en euros,
  **USDC si payé en USDC**) ;
- `Contre-valeur (EUR)` = quantité × ce prix = montant net en contrepartie → **mal libellée
  « EUR » quand la contrepartie est `usdc`** (écart ≈ 13 %).

⇒ **Coût / produit EUR d'une opération = |`Contre-valeur (EUR)`| de la jambe contrepartie.**
C'est un coût _all-in_ : le spread (intégré au prix d'exécution, jamais affiché) et les frais y
sont inclus.

## Colonne `Solde`

Solde de l'actif **après** l'opération (vide pour `eur`). Permet un contrôle d'intégrité :
recalcul des soldes et comparaison. Attention : au sein d'une même journée, l'ordre de
règlement peut différer de l'ordre des horodatages (observé sur USDC : 21 ventes en 20 minutes
réglées dans un autre ordre). Le contrôle est donc glouton par jour.

## Absents de l'export

Dépôts et retraits en euros (relevés du Compte Euro séparés). Non nécessaires au PRU.
