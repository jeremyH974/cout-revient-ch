# Coût de revient CH

[![CI](https://github.com/jeremyH974/cout-revient-ch/actions/workflows/ci.yml/badge.svg)](https://github.com/jeremyH974/cout-revient-ch/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jeremyH974/cout-revient-ch/actions/workflows/codeql.yml/badge.svg)](https://github.com/jeremyH974/cout-revient-ch/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jeremyH974/cout-revient-ch/badge)](https://scorecard.dev/viewer/?uri=github.com/jeremyH974/cout-revient-ch)

**Votre PRU et vos plus/moins-values par crypto, enfin lisibles — à partir de votre export Coinhouse.**

Application web gratuite, sans compte, qui tourne **entièrement dans votre navigateur** : votre
fichier n'est envoyé nulle part. Pensée pour les utilisateurs de Coinhouse qui veulent savoir,
ligne par ligne, leur prix de revient (spread et frais inclus, ventes partielles prises en compte),
ce qu'ils ont déjà encaissé et ce qu'ils gagneraient en vendant maintenant.

> Outil indépendant, non affilié à Coinhouse. Les chiffres affichés sont des indicateurs de
> gestion : ils ne constituent ni un conseil en investissement, ni un calcul fiscal (la plus-value
> imposable en France suit la méthode globale de l'article 150 VH bis du CGI, différente du PRU
> par actif).

**Pas encore d'export sous la main ?** Sur la page d'accueil, « Essayer avec des données
d'exemple » charge un portefeuille fictif (jeu de données synthétique, inventé de toutes pièces)
pour découvrir l'outil ;
« Quitter la démo » l'efface.

## Comment obtenir votre export Coinhouse

1. Dans l'application Coinhouse, ouvrez l'onglet **Vos transactions**.
2. Appuyez sur **Exporter**, choisissez **Export avancé**, puis validez.
3. Coinhouse vous **envoie le fichier par e-mail** (quelques minutes). Ouvrez cet e-mail sur
   l'appareil où vous utiliserez l'outil et enregistrez la pièce jointe (`historique des
transactions.csv`). Sur iPhone : appui long → _Enregistrer dans Fichiers_.
4. **N'ouvrez pas le fichier dans Excel** avant de l'importer (Excel modifie les nombres et les
   dates en l'enregistrant).
5. Importez-le dans l'application. Vous pouvez ré-importer un nouvel export à tout moment : les
   opérations déjà connues sont ignorées.

## Ce que l'outil calcule

| Indicateur      | Définition                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **PRU**         | Coût moyen d'une unité, **spread et frais inclus** (coût moyen pondéré). Il change seulement quand vous achetez, jamais quand vous vendez. |
| **Investi**     | Quantité détenue × PRU.                                                                                                                    |
| **Latent**      | Valeur actuelle − Investi (ce que vous gagneriez ou perdriez en vendant tout maintenant).                                                  |
| **Réalisé**     | Gains ou pertes déjà encaissés sur vos ventes (produit de vente − quantité vendue × PRU du moment).                                        |
| **Total**       | Réalisé + latent.                                                                                                                          |
| **ROI**         | Total ÷ somme de tous vos achats.                                                                                                          |
| **Net investi** | Somme des achats − somme des ventes : l'argent encore engagé. S'il est négatif, vous avez récupéré votre capital.                          |

### Rapport PDF

Depuis le portefeuille ou les réglages, « Rapport PDF » ouvre une vue imprimable (`#/report`) et
génère un PDF A4 (page de garde, synthèse, répartition, positions ouvertes, stablecoins, positions
clôturées, méthodologie) entièrement dans le navigateur : rien n'est envoyé. Le mode discret masque
les montants ; « Imprimer / Enregistrer en PDF » est l'alternative sans bibliothèque.

## Évolution et exports

Chaque page affiche une carte **Évolution** : valeur de vos avoirs reconstituée jour par jour
(quantités détenues × prix historiques), capital investi en pointillé, périodes 1J à Tout, et
métriques au choix — valeur, plus-value latente (€ ou %), ou **PRU face au prix** pour un actif,
avec vos achats et ventes marqués sur la courbe. La performance d'une période est calculée **hors
apports et retraits**. Exports CSV (positions, opérations avec PRU après chaque ligne, lots, série)
et rapport PDF : voir [docs/exports.md](docs/exports.md).

## Devise d'affichage

L'euro est la devise des données Coinhouse. Le bouton **€ / $** affiche tout en dollars en
convertissant **chaque mouvement au taux de référence BCE de son jour** (et les prix actuels au
dernier taux connu) : le PRU en dollars reflète le change réel de vos achats, ce qu'une simple
conversion des totaux ne ferait pas. Taux fournis par l'API ouverte Frankfurter (BCE), mis en cache
et inclus dans la sauvegarde.

## Aide et retours

Un fichier refusé, un chiffre douteux, une idée : **Réglages → Aide et retours → « Signaler
(formulaire pré-rempli) »** ouvre un signalement GitHub déjà renseigné avec le diagnostic (il ne
contient ni montant ni quantité : version, navigateur, colonnes de votre fichier, compteurs,
erreurs récentes). Ne joignez jamais votre export. Les idées passent par
[le sélecteur de gabarits](https://github.com/jeremyH974/cout-revient-ch/issues/new/choose).

## Qualité et amélioration continue

- **Auto-vérifications** (Réglages → Vérifications automatiques, rappel en bas du portefeuille) :
  à chaque affichage, l'application contrôle sa cohérence comptable (total = valeur + produits −
  achats, actif par actif), ses lots, les soldes de votre export, les prix et la sauvegarde.
- **Oracle indépendant** : un test recalcule PRU, coûts, réalisé, lots et PRU après chaque ligne
  depuis le CSV avec un code distinct du moteur et doit concorder à 10⁻⁹ près (fixture et export
  réel local).
- **Surveillance automatique** (`.github/workflows/monitor.yml`, toutes les 6 h) : parcours
  Playwright sur le site en ligne + contrat des API de prix (CoinGecko, Coinbase, Kraken, BCE) ;
  une issue « [monitoring] » s'ouvre en cas d'échec et se referme au rétablissement.
  `npm run monitor` lance la même chose localement.
- **Page Nouveautés** (Réglages → Nouveautés) : le changelog lu dans l'application ; un bandeau
  signale chaque mise à jour installée.
- **Erreurs** : une page qui plante affiche une explication, « Réessayer » et le diagnostic
  (message d'erreur inclus, jamais vos données).
- **Garde-fous CI** : seuils de couverture, tests de propriétés, E2E, axe, Lighthouse,
  Dependabot avec délai, CodeQL, Scorecard.

## Développement

```bash
npm install
npm run dev      # http://127.0.0.1:5173/cout-revient-ch/
npm run check    # lint + typecheck (svelte-check) + tests
npm run build    # dist/ (PWA, CSP injectée)
npm run preview  # sert dist/
```

Stack : Vite 8, Svelte 5 (runes), TypeScript strict, big.js (arithmétique décimale exacte),
PapaParse, Vitest. Déploiement automatique sur GitHub Pages à chaque push sur `main`
(`.github/workflows/ci.yml`).

- `src/lib/domain` : moteur pur (PRU = coût moyen pondéré all-in, lots au prorata, contrôle des
  soldes). Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et
  [docs/DECISIONS.md](docs/DECISIONS.md).
- `docs/coinhouse-export.md` : format et sémantique de l'export (colonne « Contre-valeur (EUR) »
  de la jambe crypto exprimée en USDC quand on paie en USDC, etc.).
- Tests : `npm test`. Le fichier `tests/fixtures/coinhouse/export-demo.csv` est un jeu de données
  entièrement synthétique, produit par `npm run fixture` (aucune donnée réelle, même transformée).
  Un export réel placé à la racine du projet (ignoré par git) est testé en plus, localement.
- Icônes PWA et image Open Graph : `python scripts/generate-assets.py` (Pillow).

### Qualité automatisée

- `npm run check` — lint, typage, tests unitaires et tests de propriétés (fast-check) sur le moteur.
- `npm run e2e` — tests de bout en bout Playwright sur le build de production (import de la
  fixture, démo, PRU comparés au moteur, exports CSV/PDF, sauvegarde/restauration, thème, mobile,
  accessibilité axe WCAG 2.2 AA, manifeste/service worker/CSP sans erreur console). Première fois :
  `npx playwright install chromium webkit`.
- `npm run lhci` — Lighthouse CI (accessibilité, bonnes pratiques, SEO ≥ 95 ; performance ≥ 90).
  Sous Windows, `chrome-launcher` échoue parfois à supprimer son profil temporaire (erreur
  `EPERM`) : le résultat qui fait foi est celui de la CI (Linux).
- La CI exécute tout cela et ne déploie que si tout est vert ; les rapports (Playwright, Lighthouse)
  sont joints à chaque exécution dans l'onglet Actions.

### Confidentialité

Aucun backend, aucun compte, aucune statistique. Les données restent dans le navigateur
(`localStorage`) ; seuls les tickers détenus sont envoyés à CoinGecko puis Coinbase pour les prix.
Sauvegarde/restauration JSON dans les réglages.

## Licence

MIT — voir [LICENSE](LICENSE).
