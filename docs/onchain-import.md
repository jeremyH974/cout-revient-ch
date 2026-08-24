| Bitcoin | mempool.space, secours blockstream.info (Esplora, sans clé) | `mempool.space` |

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

- **Pagination plafonnée** : 8 pages de 25 transactions par adresse Bitcoin, 2 pages par flux
  (natif, ERC-20) pour l'EVM sans clé. Au-delà, l'historique plus ancien n'est pas lu — un
  indicateur « historique tronqué » invite à resynchroniser plutôt qu'une boucle automatique. Avec
  une clé d'explorateur, ce plafond disparaît (une requête par flux suffit).
- **Débit prudent sans clé** : Blockscout annonce `x-ratelimit-limit: 180` par fenêtre (en-tête
  mesuré le 24/08/2026) ; un excès renvoie une erreur qui dit quoi faire plutôt qu'un nouvel essai
  agressif. Le client Bitcoin sérialise ses requêtes avec une pause de 250 ms.
- **Transactions échouées écartées** : leur gaz reste pourtant dépensé. Conséquence assumée : la
  quantité d'ETH suivie peut légèrement surestimer le solde réel d'une adresse qui a beaucoup de
  transactions en échec.
- **Taproot non couvert** : les adresses `bc1p…` (BIP86) ne sont pas dérivées à partir d'une clé
  étendue ; xpub (BIP44), ypub (BIP49) et zpub (BIP84) le sont.
- **Jetons ignorés** : tout ERC-20 hors de la liste blanche ci-dessus, et tout ce qui n'est ni une
  transaction native, ni une transaction interne, ni un transfert ERC-20 (NFT compris).
- **Synchronisation manuelle** : un bouton « Synchroniser » relance la lecture depuis l'écran
  Comptes ; elle est idempotente (dédoublonnage par identifiant de transaction), rejouer une
  synchronisation ne duplique rien.

## Portefeuille Bitcoin entier (clé publique étendue)

Le champ d'adresse Bitcoin accepte aussi une **clé publique étendue** (`zpub`, `ypub`, `xpub`).
Aucune API publique sans clé n'en accepte une — `GET mempool.space/api/v1/xpub/…` répond 404 — et
c'est tant mieux : confier un xpub à un tiers lui donnerait la vue permanente de tout le
portefeuille, passé et à venir. La dérivation se fait donc **dans le navigateur**
(`src/lib/import/onchain/xpub.ts`, chargé à la demande pour ne pas peser sur le bundle) :

| Saisie | Chemin de compte    | Adresses produites | Encodage                                              |
| ------ | ------------------- | ------------------ | ----------------------------------------------------- |
| `xpub` | BIP44 `m/44'/0'/0'` | `1…`               | base58check, version 0x00                             |
| `ypub` | BIP49 `m/49'/0'/0'` | `3…`               | base58check du hash du script de rachat, version 0x05 |
| `zpub` | BIP84 `m/84'/0'/0'` | `bc1q…`            | bech32, témoin v0                                     |

Balayage : chaînes 0 (réception) et 1 (monnaie), arrêt après **20 adresses vides consécutives**
(gap limit BIP44), plafond dur de 500 adresses. Une requête légère (`/address/{a}`) décide si une
adresse est utilisée ; seules celles qui le sont voient leur historique paginé.

**Le point qui compte** : les mouvements sont nettés **sur l'ensemble des adresses du
portefeuille**, pas adresse par adresse. Un portefeuille réel rend sa monnaie sur une adresse
neuve à chaque dépense ; netter par adresse compterait ce retour comme une réception et gonflerait
symétriquement dépôts et retraits. Une clé **privée** étendue (`xprv`, `yprv`, `zprv`) est refusée
à la saisie avec un avertissement, et n'est jamais enregistrée.

## Secours EVM : l'API publique Blockscout est en sursis

Blockscout a officiellement transféré son trafic vers une **Pro API** à clé le 1ᵉʳ juillet 2026.
Sondes du 24/08/2026 : les instances par chaîne répondent **encore** 200 sans clé, mais
`api.blockscout.com` renvoie déjà `402 Proceed with API key`. L'application ne dépend donc plus d'un
seul chemin :

| Ordre                     | Fournisseur                    | Clé      | Couverture            |
| ------------------------- | ------------------------------ | -------- | --------------------- |
| 1 (si une clé est saisie) | Etherscan V2 ou Blockscout Pro | gratuite | eth · arbitrum · base |
| 2                         | Blockscout par instance        | aucune   | eth · arbitrum · base |
| 3                         | Routescan                      | aucune   | Ethereum seulement    |

Les trois parlent le même dialecte `module`/`action` hérité d'Etherscan, d'où un adaptateur unique
(`etherscan.ts`). Ce chemin lit en plus les **transactions internes** (`txlistinternal`), donc l'ETH
reçu via un contrat — un pont, un DEX, un vault — qui n'apparaît nulle part dans `txlist` et
manquait jusqu'ici.

Une **clé d'explorateur de blocs n'est pas une clé d'exchange** : elle ne lit que des données
publiques déjà visibles de tous et ne peut rien signer. C'est pourquoi elle est acceptée
(facultative, dans Réglages) alors qu'une clé d'exchange reste refusée par principe
(docs/DECISIONS.md n° 32).

`scripts/api-contract.mjs`, exécuté toutes les 6 h par la surveillance, vérifie que les instances
Blockscout répondent toujours sans clé, que Routescan est disponible, et que le rejet
« Missing/Invalid API Key » d'Etherscan garde sa forme : le jour où le chemin sans clé s'arrête, la
CI le dira avant les utilisateurs.

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
