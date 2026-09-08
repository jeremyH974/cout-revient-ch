# La variante personnelle

Le même code que le site public, servi depuis votre machine, avec vos vraies données, sur une
origine à lui, sans aucune sortie réseau et derrière un mot de passe.

Ce document dit **comment la lancer**, **ce qu'elle protège**, et surtout **ce qu'elle ne protège
pas**. Cette dernière partie est la plus importante : une protection dont on surestime la portée est
plus dangereuse que pas de protection du tout.

---

## Lancer

```bash
npm run prive
```

Ouvre le serveur de développement sur **`http://crch.localhost:7331`**. C'est l'adresse à visiter —
pas `localhost:7331`, qui serait une autre origine, donc un autre stockage.

Pour la version compilée, celle qu'on utilise au quotidien :

```bash
npm run prive:build && npm run prive:serve
```

Le serveur n'écoute que sur `127.0.0.1` : rien n'est joignable depuis votre réseau Wi-Fi.

### Pourquoi `crch.localhost` et pas `localhost`

Parce que `localhost:5173` est le port par défaut de Vite, donc une origine **partagée** avec
n'importe quel autre projet que vous lancez sur cette machine. Le stockage d'un navigateur est
cloisonné par **origine**, pas par projet : un autre chantier démarré sur 5173 pourrait lire la base
`crch-state`. Le suffixe `.localhost` est résolu en boucle locale par le navigateur lui-même
(RFC 6761) — rien à ajouter au fichier `hosts` — et reste un contexte sécurisé, donc `crypto.subtle`
fonctionne et le coffre aussi.

---

## Installer le coffre

**Faites d'abord une sauvegarde chiffrée** (Réglages → Sauvegarde). Un mot de passe perdu n'est pas
récupérable : il n'existe ni compte, ni service, ni question secrète capable de rouvrir le coffre.
Cette sauvegarde est votre seul recours, et c'est le prix du tout-local sans compte.

Ensuite : Réglages → **Coffre** → Installer le coffre. Choisissez une phrase, pas un mot compliqué —
douze caractères au minimum, mais une phrase entière vaut mieux.

Ce qui se passe alors : une clé est tirée au hasard, scellée sous votre mot de passe, et tout l'état
est immédiatement réécrit **chiffré** par-dessus les copies en clair. Si cette réécriture échoue,
l'installation est défaite plutôt que de laisser un coffre posé sur des données restées lisibles.

À la réouverture, l'application affiche une porte et **rien d'autre** : elle n'a pas chargé l'état,
pas installé sa sauvegarde automatique, pas posé d'écouteur. Il n'y a rien à masquer, il n'y a rien.

Compter environ **un quart de seconde** pour ouvrir (236 ms mesurés dans Chromium). C'est le coût
d'Argon2id aux paramètres OWASP, payé une fois par session — et c'est exactement ce coût, multiplié
par les 46 Mio de mémoire qu'il exige à chaque tentative, qui rend une attaque hors ligne sur un
disque volé impraticable.

### Changer de mot de passe

Réglages → Coffre → Changer le mot de passe. L'opération ne relit ni ne réécrit vos données : elle
re-scelle 32 octets. C'est instantané quel que soit le volume, et rien ne peut rester à moitié
converti.

---

## La sortie réseau

Dans cette variante, `fetch` et `WebSocket` sont emballés au démarrage et **refusent toute origine
externe**. Ce n'est pas un réglage à cocher : c'est l'état de départ, à chaque lancement.

Conséquence à connaître : sans sortie réseau, l'application **ne peut pas coter vos actifs**. Les
montants latents reposent alors sur les derniers cours connus ou sur les prix saisis à la main. Tout
le reste — PRU, plus et moins-values réalisées, rapports, exports, réconciliation — se calcule
intégralement hors ligne.

Pour obtenir des cours : Réglages → **Sortie réseau** → cocher « Autoriser les appels sortants
pendant cette session ». Ce réglage **n'est pas enregistré**. Il expire à la fermeture de l'onglet,
délibérément : une case cochée en mars s'appliquerait encore en novembre, à un import qu'on n'avait
pas en tête.

Le même écran détaille ce que chaque famille d'origines apprendrait de vous. À retenir : les
**explorateurs de chaînes** reçoivent vos adresses publiques, donc l'intégralité des soldes et de
l'historique qui y sont attachés. C'est, de très loin, ce qui en dit le plus long sur vous — bien
plus que la liste de vos tickers envoyée aux fournisseurs de cours.

---

## Ce qui change, et ce qui ne change pas

| Menace                                                      | Site public  | Variante personnelle                              |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------- |
| Compromission du site publié ou de la chaîne de déploiement | présente     | **disparaît**                                     |
| Éviction du stockage par le navigateur                      | présente     | **disparaît**                                     |
| Fuite vers un tiers via une origine autorisée               | présente     | **disparaît** (verrou fermé)                      |
| Lecture du profil de navigateur sur le disque               | **présente** | **disparaît** (coffre)                            |
| Vol de la machine                                           | présente     | couvert par BitLocker, pas par l'application      |
| Sauvegarde en clair dans un dossier synchronisé             | présente     | inchangée — chiffrez vos exports                  |
| Dépendance npm compromise                                   | présente     | **présente, et pire** : le code a accès au disque |
| Processus malveillant sous votre compte Windows             | présente     | **présente**                                      |

Les deux dernières lignes méritent d'être lues deux fois.

**La dépendance compromise reste la menace principale.** Elle est même aggravée en local. Ce qui la
tient : `.npmrc` refuse les scripts d'installation et impose un délai de publication, les actions
GitHub sont épinglées par empreinte, et la CSP plus Trusted Types limitent ce qu'un code injecté
pourrait faire. Voir la décision n° 13.

**Rien ne protège d'un processus tournant sous votre propre compte Windows.** Ni le coffre, ni
DPAPI, ni le Credential Manager, ni le TPM. C'est le modèle du système d'exploitation, pas un défaut
d'implémentation. Un voleur d'identifiants exécuté sous votre session lit la mémoire de
l'application déverrouillée.

### Vérifiez BitLocker

Le coffre protège le stockage du navigateur ; il ne chiffre pas le reste du disque. Sous
Windows 11 24H2, le chiffrement automatique est bien plus largement activé — mais Microsoft le dit
noir sur blanc : _si l'appareil n'utilise que des comptes locaux, il reste non protégé même si les
données sont chiffrées_, faute d'avoir retiré la clé claire.

Vérifiez avec `msinfo32.exe` → **Prise en charge du chiffrement de l'appareil**.

---

## Le dépôt privé miroir

**Il existe : [`jeremyH974/cout-revient-ch-perso`](https://github.com/jeremyH974/cout-revient-ch-perso)**, privé,
raccordé sous le nom de dépôt distant `perso`. Le dépôt public reste la source du code ; celui-ci en
est une copie sous votre seul contrôle, et l'endroit où déposer ce qui n'a rien à faire en public —
notes, configurations, essais.

Synchroniser après une évolution publique :

```bash
git pull origin main && git push perso main
```

### Ce qui n'y va pas non plus

Un dépôt privé n'est pas un coffre. C'est une copie de vos fichiers sur les serveurs d'un tiers,
en clair, accessible à quiconque obtient votre jeton GitHub — et elle survit à votre machine.

**Votre export réel reste donc exclu, exactement comme du dépôt public.** `.gitignore` et
`scripts/check-no-personal-exports.js` continuent de s'appliquer ici, et c'est délibéré : le jour où
l'on prend l'habitude de committer un relevé « puisque c'est privé », il ne reste plus qu'un
changement de visibilité entre vos opérations et le monde entier.

Si vous voulez conserver un historique hors de votre machine, c'est la **sauvegarde chiffrée**
(Réglages → Sauvegarde, avec phrase secrète) qui est faite pour ça — et elle se dépose où vous
voulez, y compris dans un service de synchronisation, puisqu'elle ne se lit pas sans la phrase.

### Les workflows sont désactivés sur le miroir, exprès

`gh api -X PUT repos/<vous>/cout-revient-ch-perso/actions/permissions -F enabled=false`

Sans cela, chaque poussée y relancerait toute la CI — dont neuf minutes d'E2E et de Lighthouse — sur
le quota de minutes **payantes** d'un dépôt privé, pour un résultat que le dépôt public produit
déjà. Pire : `market-data.yml` s'exécute deux fois par semaine et **committe** ce qu'il régénère, et
`monitor.yml` toutes les six heures. Le miroir se serait mis à diverger tout seul, par un chemin que
personne ne surveille.

### Dependabot, lui, ne s'arrête pas là

Couper les workflows **ne suffit pas** : les mises à jour de version de Dependabot sont une
fonctionnalité distincte, pilotée par `.github/dependabot.yml` sur la branche par défaut. À la
création du miroir, elle a ouvert quatre PR dans la minute — avant même que la coupure ne prenne.

Il n'existe **aucun réglage REST** pour l'éteindre (`security_and_analysis` ne couvre que les mises
à jour de _sécurité_). C'est un clic, une fois, dans le miroir : **Settings → Code security →
Dependabot version updates → Disable**.

Si des PR `chore(deps)` réapparaissent sur le miroir, c'est ce clic qui manque. Elles ne sont pas
dangereuses — juste du bruit sur un dépôt que personne ne relit, et des minutes consommées pour un
travail que le dépôt public fait déjà.

Le corollaire à ne pas oublier : **le miroir ne vérifie rien**. C'est la CI du dépôt public qui fait
foi, donc on continue d'ouvrir ses PR là-bas.

**Une branche privée dans le dépôt public est le seul schéma à écarter.** Tout ce qui est poussé
dans un dépôt public est public, y compris une branche qu'on croit oubliée : les objets restent
accessibles par leur empreinte même après suppression de la référence.

### Le garde-fou qui compte

`scripts/check-no-personal-exports.js` fait échouer `npm run lint` si un relevé (`.csv`, `.xlsx`,
`.xls`, `.xlsm`) suivi par git se trouve hors de `tests/fixtures/`. C'est plus pertinent qu'un
scanner de secrets générique : ceux-ci cherchent des motifs de jetons d'API, pas un export de
portefeuille.

Pour qu'il agisse **avant** que le commit n'existe plutôt qu'après :

```bash
npm run hooks:install
```

Attention : les hooks de cycle de vie npm sont inertes dans ce dépôt (`ignore-scripts` dans
`.npmrc`, décision n° 13). L'installation doit donc être explicite — c'est le sens de cette commande.

---

## Ce que la variante personnelle ne fait délibérément pas

- **Pas de déverrouillage par Windows Hello.** L'extension WebAuthn `prf` permettrait de dériver la
  clé depuis une passkey. La spécification est stable (WebAuthn niveau 3, recommandation W3C
  d'août 2026) et l'API Windows expose `hmac-secret`, mais le chemin complet côté Windows Hello
  reste mal établi — chez Bitwarden, l'incident « impossible de créer une passkey compatible PRF
  sur Windows Hello » est ouvert depuis mars 2026. Et une passkey liée au TPM ne quitte pas la
  machine : elle ne peut donc jamais être l'unique dépositaire. À reconsidérer quand le support
  sera net, **en surcouche** du mot de passe, jamais à sa place.
- **Pas de binaire Tauri.** Son seul apport ici serait d'écrire sur le disque sans dialogue, contre
  une chaîne Rust complète et plusieurs minutes de compilation à chaque build. Il ne répond pas à la
  menace qui reste (§ processus sous le même compte).
- **Pas d'OPFS.** Mêmes quotas, même éviction, aucun chiffrement implicite, et un Worker dédié en
  plus. Pour quelques mégaoctets d'état, IndexedDB fait mieux.
- **Pas d'Argon2id natif.** Il n'existe pas : au 8 septembre 2026, la proposition WICG qui
  l'ajouterait à WebCrypto n'est pas sur la voie standard, et l'intention d'implémentation de Chrome
  (version 154) ne le contient pas. L'implémentation en JS pur de `@noble/hashes` est le seul chemin,
  et elle ne coûte aucune dépendance nouvelle.
