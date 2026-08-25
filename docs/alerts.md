# Alertes de prix et simulateur « et si ? »

> P29, livré le 25/08/2026 — décision de conception : `docs/DECISIONS.md` n° 36.
> 2.2.0 : dollars avec le toggle (décision n° 37) et vérification opportuniste app fermée
> (Periodic Background Sync, décision n° 38).
> Recherche menée le 25/08/2026 (état de l'art des trackers, capacités réelles du web local-first,
> simulateurs, intégrations TradingView/MCP) ; les sources sont en fin de document.

## Ce que ça fait

Depuis `#/invest/alerts` (ou la fiche d'un actif) :

- **Alertes relatives au PRU** : « BTC passe 10 % sous mon PRU », « objectif PRU +25 % »,
  « objectif **+X % net de frais de vente** », ou prix exact en euros. Les seuils relatifs
  **suivent le PRU recalculé** : un nouvel achat les déplace d'eux-mêmes — aucune alerte
  « zombie », là où un seuil posé chez un courtier devient obsolète en silence.
- **Centre d'alertes** : déclenchements récents (avec actions « simuler un rachat / une vente à
  ce prix »), historique borné à 100 entrées, pastille d'application (Badging API), toasts
  in-app, notifications système **opt-in** (le clic ramène à l'app).
- **Veille opt-in** : actualisation automatique des prix toutes les 1 à 15 min tant que des
  alertes sont armées et que l'app est ouverte (même en arrière-plan : une cadence ≥ 1 min
  survit au regroupement des réveils de Chrome).
- **Simulateur** sur chaque actif : rachat (nouveau PRU, frais inclus), vente (produit net,
  résultat **net de frais**, prix d'équilibre frais inclus, « récupérer ma mise », sortie euros
  vs stablecoin), objectif de PRU (montant à investir pour amener le PRU à une cible).

## Sémantique de déclenchement (précise, car c'est là que tout se joue)

- **Franchissement, jamais niveau** : une règle armée se déclenche quand le prix franchit le
  seuil, puis se désarme. Une règle récurrente se **réarme** quand le prix s'éloigne d'au moins
  **1 %** de l'autre côté du seuil ; une règle « une fois » attend un ré-armement manuel.
- **Au plus un déclenchement par heure et par règle** ; un déclenchement retenu par ce délai
  reste dû (la règle reste armée), jamais perdu.
- **Créer une alerte ne notifie jamais** : si la condition est déjà remplie à la création, la
  règle naît désarmée et l'aperçu l'explique.
- Seules des **cotations fraîches** déclenchent (jamais le cache périmé rechargé au démarrage) ;
  un prix manuel saisi par l'utilisateur compte comme une cotation fraîche.
- Tout est calculé **en euros** (devise des données), quelle que soit la devise d'affichage, par
  l'unique fonction `alertThresholdEur` — l'aperçu, la liste et l'évaluation ne peuvent pas se
  contredire.

**Dollars avec le toggle (2.2.0, décision n° 37).** Quand l'affichage est en dollars, les
feuilles saisissent et affichent en dollars, convertis au taux BCE du jour à la frontière — le
moteur ne voit que des euros. Le type « Prix exact » tapé en dollars devient un seuil **ancré en
dollars** (`price-usd`, évalué par `seuil € = prix $ ÷ taux(jour)`) : le chiffre tapé garde son
sens, comme une alerte de paire BTC/USD chez un exchange, au lieu de dériver quand l'euro-dollar
bouge. Les seuils en % du PRU sont sans devise ; une règle garde sa devise d'ancrage quel que
soit le toggle ; sans taux connu, une règle dollar est « dormante ». Propriété vérifiée :
évaluer `price-usd` au taux r ≡ évaluer le seuil euro `$ ÷ r`.

**Seuil « net de frais »** : prix `P` tel que vendre toute la position dégage X % net au barème
choisi — `P = (PRU × (1 + X %) + fixe ÷ quantité) ÷ (1 − taux)`. Vérifié par propriété : vendre
au seuil rend exactement l'objectif (1e-9 près).

## Frais (grille Coinhouse Particuliers « Classique », publiée le 18/08/2026)

| Opération                                       | Taux   | Fixe   |
| ----------------------------------------------- | ------ | ------ |
| Achat via Compte Euro / virement SEPA           | 0,99 % | 0,12 € |
| Achat par carte bancaire                        | 1,99 % | 0,12 € |
| Vente contre euros                              | 1,29 % | 0,12 € |
| Conversion crypto↔crypto (dont vers USDC/EURCV) | 0,79 % | 0,12 € |
| Conversion stablecoin↔stablecoin                | 0,19 % | 0,12 € |

Préréglages **modifiables** dans le simulateur (la grille changera ; l'outil ne doit pas mentir)
et **figés dans chaque règle** « net de frais » à sa création. Modèle all-in identique au moteur :
à l'achat, les frais réduisent la quantité reçue, jamais le coût de revient ; à la vente, ils
réduisent le produit net ; **vendre ne change jamais le PRU**. Sortir vers un stablecoin coûte
0,79 % et reste un échange crypto↔crypto (sursis fiscal de l'art. 150 VH bis) ; vendre en euros
coûte 1,29 % et constitue une cession imposable — information indicative, pas un conseil.

## Ce qui est possible sans serveur (et ce qui ne l'est pas)

| Situation                                 | Évaluer les seuils                                                                                                                          | Notifier (système)                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onglet / PWA ouvert, même en arrière-plan | **Oui** (veille ≥ 1 min)                                                                                                                    | **Oui** (permission accordée)                                                                                                                                     |
| PWA installée mais fermée                 | **Opportuniste depuis 2.2.0** (Periodic Background Sync, décision n° 38 : Chromium seul, cadence décidée par le navigateur, jamais promise) | **Oui, quand le réveil a lieu** (mêmes notifications, mêmes seuils)                                                                                               |
| Navigateur fermé                          | Non                                                                                                                                         | Non — seul le Web Push réveille, et il **exige un serveur** (VAPID), y compris la « Declarative Web Push » de WebKit (qui simplifie la réception, pas l'émission) |

C'est le prix du « rien ne quitte le navigateur » : aucun serveur ne connaît les seuils ni le
PRU. L'interface le dit en toutes lettres au lieu de le laisser deviner. Les Notification
Triggers (notifications planifiées hors ligne) sont officiellement abandonnés par Chrome.

**Comment marche la vérification opportuniste (2.2.0, décision n° 38).** L'app précalcule un
instantané (seuils EUR en chaînes décimales, identifiants CoinGecko, états d'armement) dans le
meta-store IndexedDB ; au réveil `periodicsync`, le service worker (`public/sw-alerts-core.js` +
`sw-alert-sync.js`) demande les prix EUR à CoinGecko (identifiants d'actifs seuls — rien de plus
que la veille classique), compare en **décimal exact sans flottant** (`cmpDec`, prouvé équivalent
à big.js par propriétés via node:vm), notifie, et dépose les déclenchements que l'app journalise
à l'ouverture. Conservateur par construction : pas de ré-armement côté service worker, règle
inconnue = non armée, app visible = le service worker s'efface. Conditions : veille activée +
notifications système accordées + au moins une alerte armée + PWA installée (Chromium). Pour la
notification **garantie** app fermée et le serveur MCP local, voir la proposition chiffrée :
`docs/proposals/2026-08-push-et-mcp.md` (sources du 25/08/2026 ; recommandation : MCP local
d'abord).

## Ce que font les meilleurs (recherche du 25/08/2026)

- **Répétition** : one-shot vs récurrent partout (Delta « One-off / Repeating », Binance
  « Once / Once a day / Always », CoinGecko « Once / Recurring », TradingView « Only once / Once
  per bar / Once per minute »). Anti-spam uniquement **temporel** (1 h fixe chez Delta, 1/jour
  chez Binance) ; l'hystérésis de ré-armement n'est documentée nulle part — la nôtre est
  au-dessus de l'état de l'art grand public.
- **Alertes relatives au coût de revient : personne** côté crypto grand public. Delta calcule le
  cost basis mais n'alerte pas dessus ; CoinStats n'a qu'une alerte de valeur totale (premium) ;
  Binance/Kraken/Coinbase connaissent les positions et n'alertent que sur le prix de marché.
  Seul **Interactive Brokers** propose une alerte de P&L (du jour, desktop pro). C'est le
  différenciateur naturel d'un outil qui calcule le PRU.
- **UX** : création en deux gestes depuis la fiche de l'actif (cloche), raccourcis ± % depuis le
  cours (Kraken, CoinGecko), centre actives/passées (Kraken), champ note (CoinStats), expiration
  automatique contre les alertes zombies (Binance 90 j, CoinGecko 45 j) — ici inutile : nos
  seuils suivent le PRU, et une règle sans position s'affiche « dormante ».
- **Simulateurs** : les « average down calculators » saisissent des parts + prix ; la saisie en
  **montant** (naturelle pour un acheteur en euros) est un angle mort. Le **mode inverse**
  (« quel montant pour viser tel PRU ») est rare (StockAverager). Les trackers grand public ne
  simulent pas un rachat au niveau position (Kubera « Fast Forward » = patrimoine global,
  CoinStats « Exit Strategy » = paliers de vente en alertes) — un simulateur branché sur la
  position réelle est une vraie différenciation. « La vente ne change pas le PRU » est
  contre-intuitif et mérite d'être écrit (confirmé par Lynta, T. Rowe Price, BoursoBank).
- **Échelle de prise de profit** : pratique documentée (paliers 25 % à +25/+50/+100 %…, « sell
  to initial » / house money) — d'où le bouton « échelle » (trois alertes « une fois ») et
  « récupérer ma mise » net de frais.

## TradingView, MCP : étudié, et tranché (25/08/2026)

- **Pas de MCP officiel TradingView**, pas d'API de données publique ; les webhooks d'alertes
  exigent un abonnement payant **et un serveur public** répondant en < 3 s — incompatible avec
  « aucun backend ». Les serveurs MCP communautaires reposent sur du scraping (ToS hostiles,
  bibliothèque de base `tradingview-ta` archivée). → **À éviter** comme dépendance produit.
- **Court terme retenu** : nos alertes locales + la chaîne de prix existante.
- **Pistes futures compatibles** (sans toucher au moteur, qui est pur) :
  1. un **émetteur opt-in** (micro-worker cron + Web Push VAPID, ou relais ntfy à sujet
     aléatoire) rejouant `evaluateAlerts` côté serveur — rupture assumée du local-first, à
     consentement explicite ;
  2. un **serveur MCP local** exposant portefeuille/PRU/seuils (précédents open source : firma,
     kukapay/crypto-portfolio-mcp), à croiser dans Claude avec le **MCP officiel CoinGecko**
     (`mcp.api.coingecko.com`, sans clé) ou le MCP officiel CCXT ;
  3. un lien « ouvrir dans TradingView » + copie du seuil formaté, pour qui veut créer sa vraie
     alerte push là-bas (zéro dépendance, zéro donnée sortante).

## Sources (consultées le 25/08/2026)

Plateformes et trackers :

- TradingView — About alerts / configuration : https://www.tradingview.com/support/solutions/43000520149-about-alerts/ · https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/
- Delta (One-off / Repeating 1 h) : https://support.delta.app/en/articles/1428729-how-do-i-add-delete-an-alert
- CoinStats (types d'alertes, notes) : https://help.coinstats.app/en/articles/3573865-how-to-set-up-custom-alerts · Exit Strategy : https://help.coinstats.app/en/articles/8799051-exit-strategy
- Binance (Once/Daily/Always, 90 j, 50 max) : https://support.binance.us/en/articles/9842911-how-to-set-up-price-alerts-on-the-binance-us-app
- CoinGecko (Once/Recurring, Auto Price Alerts 45 j) : https://support.coingecko.com/hc/en-us/articles/4539008143257 · https://support.coingecko.com/hc/en-us/articles/50961786314777
- Kraken (création riche, actives/passées) : https://support.kraken.com/articles/price-alerts
- Coinbase (alertes auto + custom) : https://help.coinbase.com/en/coinbase/trading-and-funding/pricing-and-fees/what-are-price-alerts
- Interactive Brokers (alerte P&L du jour) : https://ibkrguides.com/tws/usersguidebook/realtimeactivitymonitoring/pnlalert.htm

Plateforme web (notifications local-first) :

- MDN — Notifications API (permission sur geste) : https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API · constructeur (TypeError mobile) : https://developer.mozilla.org/en-US/docs/Web/API/Notification/Notification · Push API (VAPID, serveur requis) : https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- web.dev — UX de permission (pre-prompt) : https://web.dev/articles/push-notifications-permissions-ux
- WebKit — Declarative Web Push (l'émission ne change pas) : https://webkit.org/blog/16535/meet-declarative-web-push/ · push iOS (PWA installée seulement) : https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Chrome — Periodic Background Sync (engagement, Chromium) : https://developer.chrome.com/docs/capabilities/periodic-background-sync · Notification Triggers (abandonné) : https://developer.chrome.com/docs/web-platform/notification-triggers · throttling des timers (1/min) : https://developer.chrome.com/blog/timer-throttling-in-chrome-88 · Page Lifecycle (frozen/discarded) : https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Mozilla — position « harmful » sur Periodic Background Sync : https://github.com/mozilla/standards-positions/issues/214
- MDN — Badging API : https://developer.mozilla.org/en-US/docs/Web/API/Badging_API

Frais, formules, simulateurs :

- Grille tarifaire Coinhouse (18/08/2026) : https://cms-www.coinhouse.com/wp-content/uploads/2026/08/CH_-GrilleTarifaire_Web_FR_AUG26.pdf
- BoursoBank — PRU frais inclus : https://www.boursobank.com/aide-en-ligne/bourse/comment-investir-en-bourse/fonctionnement-de-la-bourse/question/comment-se-calcule-le-prix-de-revient-pru-au-comptant-642
- Lynta — PRU et plus-value (la vente ne change pas le PRU) : https://lynta.fr/guides/comprendre-pru-et-plus-value
- T. Rowe Price — coût moyen : https://www.troweprice.com/personal-investing/resources/planning/tax/education/cost-basis-accounting-and-calculation.html
- StockAverager — mode inverse (« Target Average Price ») : https://www.stockaverager.com/tools/stock-averager
- Coin Bureau — exit strategies / sell to initial : https://coinbureau.com/guides/crypto-exit-strategies
- NN/g — sliders vs champs, steppers : https://www.nngroup.com/articles/gui-slider-controls/ · https://www.nngroup.com/articles/input-steppers/

TradingView / MCP :

- TradingView — webhooks (serveur requis, < 3 s, 2FA) : https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/ · pas d'API de données : https://www.tradingview.com/widget-docs/faq/data/ · ToS : https://www.tradingview.com/policies/
- CoinGecko — serveur MCP officiel : https://docs.coingecko.com/ai-integration/mcp-server
- CCXT — serveur MCP officiel : https://github.com/ccxt/ccxt/tree/master/mcp
- Serveurs MCP TradingView communautaires (état, risques) : https://github.com/atilaahmettaner/tradingview-mcp · https://github.com/tradesdontlie/tradingview-mcp · bibliothèque archivée : https://github.com/brian-the-dev/python-tradingview-ta
