# Proposition chiffrée — notifications app fermée et serveur MCP local

_Établie le 25/08/2026. Statut : **proposition** — rien ici n'est construit ni décidé. Tous les
chiffres ont été vérifiés en ligne le 25/08/2026 (sources en bas de page) ; les revérifier avant
tout lancement._

## Contexte et contrainte

L'app est statique, locale-first, sans compte ni serveur : les alertes de prix (décision n° 36)
s'évaluent app ouverte, et depuis la décision n° 38 une vérification opportuniste app fermée
existe sur Chromium installé (Periodic Background Sync) — **sans garantie de fréquence**. La seule
voie **garantie** app fermée est un émetteur push côté serveur. Ce document chiffre les deux
options « bonus serveur » restantes : un émetteur Web Push opt-in (A) et un serveur MCP local (B).

## Option A — Émetteur Web Push opt-in (Cloudflare Worker + VAPID)

**Architecture.** L'app propose un opt-in explicite « notifications app fermée » : elle envoie
l'abonnement push du navigateur (`PushManager.subscribe`, clé publique VAPID) **et les seuils EUR
précalculés** à un Worker Cloudflare. Un Cron Trigger (toutes les 5 min) interroge CoinGecko une
seule fois pour l'union des actifs suivis, compare, et pousse une notification Web Push aux
abonnements franchis. Stockage des abonnements et des états d'armement dans Workers KV.

**Compatibilité.** Chrome/Edge/Firefox : Web Push classique (service worker). Safari/iOS :
**Declarative Web Push** — même transport VAPID inchangé, il suffit d'envoyer le payload JSON
`{"web_push": 8030, "notification": {"title", "navigate", …}}` ; disponible Safari 18.5+ (macOS)
et PWA installée sur iOS/iPadOS 18.4+. Un seul émetteur couvre donc tout le monde.

**Bibliothèque.** `web-push` (npm) reste la référence Node (v3.6.7, publiée 16/01/2024 ; dépôt
actif, dernier commit 17/08/2026) **mais ne tourne pas sur Workers** (API crypto Node). Sur
Workers, prendre une implémentation WebCrypto : PushForge (`@pushforge/builder`), `web-push-neo`
ou `web-push-browser` — adoption plus faible, à auditer avant usage (≈ 300 lignes de spec RFC 8291
/ 8292 au total).

**Chiffrage.**

| Poste          | Valeur                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coût récurrent | **0 €/mois** (plan Workers Free) tant que : ≤ 100 000 requêtes/jour (un cron 5 min ≈ 288 invocations/jour + les push sortants comptés en sous-requêtes, ≤ 50 par invocation), CPU ≤ 10 ms par réveil (la comparaison de seuils tient largement ; l'attente réseau ne compte pas), **≤ 1 000 écritures KV/jour** — c'est le vrai goulot : écrire un état d'armement par déclenchement le respecte, écrire à chaque cron non. Au-delà : plan Paid 5 $/mois. |
| Effort initial | **3 à 5 jours** : Worker (cron, KV, VAPID WebCrypto, payload déclaratif Safari) ≈ 2 j ; côté app (opt-in, abonnement, envoi/synchro des seuils, révocation) ≈ 1 j ; tests + docs + page vie privée ≈ 1 j ; marge d'audit de la lib push ≈ 1 j.                                                                                                                                                                                                            |
| Maintenance    | ≈ 0,5 jour/trimestre (dépendances, rotation éventuelle des clés VAPID, contrat CoinGecko).                                                                                                                                                                                                                                                                                                                                                                |
| Vie privée     | **C'est le prix réel de l'option** : les seuils (et donc une information dérivée du PRU) quittent l'appareil vers le Worker. Opt-in explicite, page Confidentialité à réécrire, suppression à distance à offrir. Aucune atténuation technique complète possible : le serveur doit comparer pour pousser.                                                                                                                                                  |
| Risques        | Lib push WebCrypto jeune ; quotas Free redimensionnés par Cloudflare ; charge de preuve « le serveur ne log rien » impossible à apporter à l'utilisateur.                                                                                                                                                                                                                                                                                                 |

**Variantes écartées.**

- **ntfy.sh (service public)** : 250 messages/jour par IP émettrice, topics non protégés (« the
  topic is essentially a password »), réservation de topic payante (Supporter 6 $/mois). Simple
  mais dégradé ; self-host possible (Apache-2.0/GPLv2) mais c'est alors un serveur de plus à tenir.
- **GitHub Actions `schedule` comme émetteur** : intervalle minimal 5 min **non garanti**
  (retards documentés en heures de pointe, jobs abandonnés possibles), et workflow **désactivé
  automatiquement après 60 jours sans activité du dépôt**. Gratuit (dépôt public) mais pas fiable
  pour de l'alerte — au mieux un canal « résumé quotidien ».

## Option B — Serveur MCP local (lecture seule)

**Architecture.** Un serveur MCP **stdio, local, lecture seule** (`@modelcontextprotocol/sdk`
^1.30.0, stable au 25/08/2026 ; un SDK v2 est en bêta — ne pas s'y accrocher encore) qui réutilise
le moteur du dépôt (imports directs de `src/lib/domain`) et lit **le fichier de sauvegarde** que
l'app écrit déjà (sauvegarde automatique dans un dossier, Chrome/Edge, ou export JSON manuel).
Outils v1 : `get_portfolio`, `get_position(asset)`, `list_alerts`, `evaluate_alerts` (sur des prix
fournis), `simulate_buy` / `simulate_sell` / `break_even` — les mêmes fonctions pures que l'écran,
donc les mêmes chiffres. Les prix frais viennent du **serveur MCP officiel CoinGecko** branché à
côté (`https://mcp.api.coingecko.com/mcp`, gratuit, sans clé, limites partagées non publiées —
usage léger seulement).

**Déclaration.** Claude Code : `claude mcp add cout-revient -- node dist/server.js` ou entrée
`mcpServers` dans un `.mcp.json` committable (approbation à l'ouverture) ; Claude Desktop :
`claude_desktop_config.json`. Distribution simple : un dossier `mcp/` dans ce dépôt, `npm run
mcp:build`.

**Chiffrage.**

| Poste          | Valeur                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coût récurrent | **0 €** (local).                                                                                                                                                                             |
| Effort initial | **1,5 à 2,5 jours** : lecture/validation de la sauvegarde (le format et `sanitizeState` existent) ≈ 0,5 j ; outils MCP + schémas ≈ 0,5–1 j ; tests contre la fixture + docs ≈ 0,5–1 j.       |
| Vie privée     | **Rien ne sort de la machine** (le seul réseau est CoinGecko, déjà utilisé par l'app, et seulement si on branche leur MCP).                                                                  |
| Risques        | Faibles : SDK qui bouge vite (figer ^1.30.0), sauvegarde périmée si l'utilisateur n'a pas activé le dossier automatique (le dire dans la réponse de l'outil : « données du JJ/MM à HH:MM »). |
| Valeur         | Poser des questions en langage naturel sur son portefeuille depuis Claude (Code/Desktop), croiser avec les prix CoinGecko, préparer des simulations — sans toucher à l'app.                  |

## TradingView (pour mémoire)

Toujours **ni API publique de données ni MCP officiel** au 25/08/2026 (uniquement des projets
tiers non affiliés). Le seul pont raisonnable reste un **deep link** de facto vers un graphique
(`https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCEUR&interval=60`) — non contractuel, peut
casser sans préavis ; envisageable comme simple lien sortant dans l'app, hors périmètre serveur.

## Comparatif et recommandation

|                | A — Émetteur push                                 | B — MCP local              |
| -------------- | ------------------------------------------------- | -------------------------- |
| Coût récurrent | 0 €/mois (free tier, goulot KV 1 000 écritures/j) | 0 €                        |
| Effort         | 3–5 j                                             | 1,5–2,5 j                  |
| Fiabilité      | Bonne (cron 5 min)                                | n/a (à la demande)         |
| Vie privée     | **Seuils hors de l'appareil** (opt-in)            | Rien ne sort               |
| Dépendances    | Cloudflare, lib VAPID WebCrypto, CoinGecko        | SDK MCP, sauvegarde à jour |

**Recommandation : B d'abord, A seulement sur besoin prouvé.** Le MCP local est deux fois moins
cher en effort, ne coûte rien, ne touche pas au modèle de confidentialité (« vos données ne
quittent jamais votre appareil » reste vrai à la lettre), et rend un service immédiat. L'émetteur
push n'a de sens que si, à l'usage, la vérification opportuniste Chromium (décision n° 38) s'avère
trop rare **et** que le besoin app-fermée est réel ; le jour venu, la voie Cloudflare Worker +
VAPID (payload déclaratif Safari inclus) est la seule des trois variantes à la fois fiable et
gratuite — ntfy public et GitHub Actions cron sont documentés ici pour ne pas les re-instruire.

## Sources (consultées le 25/08/2026)

- Cloudflare Workers, limites (100 000 req/j Free, CPU 10 ms, 5 Cron Triggers, 50 sous-requêtes) :
  <https://developers.cloudflare.com/workers/platform/limits/> ; Cron Triggers :
  <https://developers.cloudflare.com/workers/configuration/cron-triggers/> (comptabilisation dans
  le plafond : blog du 28/09/2020, <https://blog.cloudflare.com/introducing-cron-triggers-for-cloudflare-workers/>) ;
  KV Free (100 000 lectures/j, 1 000 écritures/j, 1 GB) :
  <https://developers.cloudflare.com/kv/platform/limits/> ; tarif Paid 5 $/mois :
  <https://developers.cloudflare.com/workers/platform/pricing/>.
- `web-push` 3.6.7 (16/01/2024), MPL-2.0 : registre npm ; dépôt actif (push du 17/08/2026) :
  <https://github.com/web-push-libs/web-push> ; incompatibilité Workers : issue n° 718 du même
  dépôt. Alternatives WebCrypto : <https://github.com/draphy/pushforge>,
  <https://github.com/ryoppippi/web-push-neo>, `web-push-browser` (npm).
- Declarative Web Push : <https://webkit.org/blog/16535/meet-declarative-web-push/> (27/03/2025) ;
  disponibilité Safari 18.5 / iOS 18.4 PWA installée : session WWDC25 n° 235
  (<https://developer.apple.com/videos/play/wwdc2025/235/>) et notes Safari 18.4/18.5 (webkit.org).
- ntfy.sh : limites du service public (250 msg/j, rafale 60, topic = mot de passe) :
  <https://docs.ntfy.sh/publish/#limitations> ; tarifs (API `https://ntfy.sh/v1/tiers`) ;
  self-host et licence : <https://docs.ntfy.sh/faq/>.
- GitHub Actions `schedule` (5 min minimum, retards, coupure à 60 j d'inactivité) :
  <https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows> ;
  gratuité des dépôts publics :
  <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>.
- MCP : SDK TypeScript 1.30.0 (27/07/2026, v2 en bêta) : registre npm +
  <https://github.com/modelcontextprotocol/typescript-sdk> ; serveur MCP officiel CoinGecko
  (public, sans clé) : <https://docs.coingecko.com/ai-integration/mcp-server> ; déclaration
  Claude Desktop : <https://modelcontextprotocol.io/quickstart/user> ; Claude Code (`claude mcp
add`, `.mcp.json`) : <https://code.claude.com/docs/en/mcp>.
- TradingView : absence d'API publique de données / de MCP officiel (recherche du 25/08/2026,
  preuve négative) ; deep link de facto :
  <https://www.tradingview.com/support/solutions/43000673907-how-to-open-a-tradingview-chart-link-in-desktop-app/>.
