# Suivi on-chain par adresse publique (sourcé le 24/08/2026, lecture seule)

Un compte on-chain suit les mouvements d'une **adresse publique** que vous détenez en auto-garde
(wallet), sans jamais demander de clé privée ni de seed — dans le même esprit que l'import
Hyperliquid en lecture seule (docs/DECISIONS.md n° 22 et n° 28). Un compte par (chaîne, adresse),
depuis l'écran **Comptes** (`src/lib/import/onchain/{btc,evm,normalize}.ts`,
`AppState.addOnchainAccount`/`syncOnchain`) ; l'adresse est validée par un motif propre à sa chaîne
avant tout appel réseau (`BTC_ADDRESS_RE`, `EVM_ADDRESS_RE`).

## Les 4 chaînes

| Chaîne       | Fournisseur                           | Hôte                      |
| ------------ | ------------------------------------- | ------------------------- |
| Bitcoin      | mempool.space (API Esplora, sans clé) | `mempool.space`           |
| Ethereum     | Blockscout API v2 (sans clé)          | `eth.blockscout.com`      |
| Arbitrum One | Blockscout API v2 (sans clé)          | `arbitrum.blockscout.com` |
| Base         | Blockscout API v2 (sans clé)          | `base.blockscout.com`     |

Ces quatre hôtes ont un CORS ouvert (`access-control-allow-origin: *`), vérifié le 24/08/2026 —
c'est ce qui permet de les interroger directement depuis le navigateur, sans passer par un serveur
intermédiaire (décision n° 1).

## Ce qui est suivi

- **Bitcoin** : mouvement **net** par transaction confirmée (Σ sorties reçues − Σ entrées
  dépensées par l'adresse) ; un envoi porte donc sa part de frais réseau dans la quantité qui sort ;
  un mouvement net nul (monnaie rendue à soi-même) est un auto-transfert, ignoré.
- **EVM** : transactions natives (ETH — le gaz d'un envoi s'ajoute à la quantité sortie, même sans
  valeur transportée) et transferts **ERC-20 de la liste blanche** ci-dessous ; le reste (NFT,
  interactions de contrat sans transfert suivi…) n'apparaît pas.

Chaque mouvement devient un dépôt ou un retrait **sans valeur EUR** (`sent`/`received` renseignés,
jamais de contre-valeur estimée) : ce sont par construction soit des candidats à l'appariement de
virement interne (section suivante), soit des lignes « à qualifier », jamais un chiffre inventé.

## Liste blanche de jetons (EVM)

Seuls des jetons ERC-20 reconnus par leur **adresse de contrat** (jamais par leur symbole affiché)
sont importés :

| Chaîne       | Jeton      | Motif                                                                                                                                             |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ethereum     | USDC, USDT | contrats officiels Circle/Tether                                                                                                                  |
| Arbitrum One | USDC, USDT | l'USDT d'Arbitrum s'affiche « USDT0 » depuis sa migration de janvier 2026, mais reste le même contrat — s'y fier aurait fait disparaître le jeton |
| Base         | USDC       | contrat officiel Circle                                                                                                                           |

Un jeton hors liste est compté « ignoré », jamais importé à l'aveugle — un wallet actif reçoit en
permanence de faux jetons envoyés par des adresses inconnues (anti-spam). Extensible sur demande.

## Limites

- **Pas de xpub/zpub** : seules les adresses simples sont acceptées ; l'API ne dérive pas les
  adresses filles d'un portefeuille HD, donc pas de suivi automatique d'un wallet multi-adresses.
- **Pagination plafonnée** : 8 pages de 25 transactions pour Bitcoin, 2 pages par flux (natif,
  ERC-20) pour l'EVM par défaut. Au-delà, l'historique plus ancien n'est pas lu — un indicateur
  « historique tronqué » invite à resynchroniser plus tard plutôt qu'une boucle automatique.
- **Débit prudent sans clé** : Blockscout limite à environ 3 requêtes par minute en usage anonyme
  (observé, non garanti par son éditeur) ; un excès renvoie une erreur explicite (« réessayez dans
  une minute ») plutôt qu'un nouvel essai agressif qui aggraverait la limitation.
- **Jetons ignorés** : tout ERC-20 hors de la liste blanche ci-dessus, et tout ce qui n'est ni une
  transaction native ni un transfert ERC-20 (NFT compris).
- **Synchronisation manuelle** : un bouton « Synchroniser » relance la lecture depuis l'écran
  Comptes ; elle est idempotente (dédoublonnage par identifiant de transaction), rejouer une
  synchronisation ne duplique rien.

## Vie privée

L'adresse suivie n'est envoyée **qu'à l'API de sa propre chaîne** (une adresse Bitcoin part vers
mempool.space, une adresse EVM vers l'instance Blockscout de sa chaîne — jamais aux trois autres) et
n'est stockée que sur cet appareil. Comme pour le reste de l'app, aucun serveur intermédiaire :
l'appel part directement du navigateur (docs/DECISIONS.md n° 1 et n° 28 ; écran Confidentialité de
l'app).

## Cas d'usage principal : le retrait qui rejoint un wallet suivi

Un retrait Coinhouse (ou de toute autre plateforme déjà importée) sans produit renseigné, et un
dépôt on-chain sans coût renseigné, du même actif, sont candidats à l'**appariement de virement
interne** (docs/DECISIONS.md n° 25) : la sortie se fait au coût (réalisé nul) et la totalité du coût
de la cession devient le coût d'acquisition du dépôt sur le wallet — le coût **voyage**, jamais de
plus-value fantôme sur un simple transfert vers votre propre adresse. L'appariement se corrige ou se
force manuellement depuis l'écran Comptes ; un mouvement resté seul (hors fenêtre, quantité trop
éloignée) est signalé comme orphelin plutôt que silencieusement ignoré.
