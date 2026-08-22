# Coût de revient CH

**Votre PRU et vos plus/moins-values par crypto, enfin lisibles — à partir de votre export Coinhouse.**

Application web gratuite, sans compte, qui tourne **entièrement dans votre navigateur** : votre
fichier n'est envoyé nulle part. Pensée pour les utilisateurs de Coinhouse qui veulent savoir,
ligne par ligne, leur prix de revient (spread et frais inclus, ventes partielles prises en compte),
ce qu'ils ont déjà encaissé et ce qu'ils gagneraient en vendant maintenant.

> Outil indépendant, non affilié à Coinhouse. Les chiffres affichés sont des indicateurs de
> gestion : ils ne constituent ni un conseil en investissement, ni un calcul fiscal (la plus-value
> imposable en France suit la méthode globale de l'article 150 VH bis du CGI, différente du PRU
> par actif).

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
- Tests : `npm test`. Le fichier `tests/fixtures/coinhouse/export-anonymized.csv` est une fixture
  anonymisée (`npm run anonymize -- <export.csv>`). Un export réel placé à la racine du projet
  (ignoré par git) est testé en plus, localement.
- Icônes PWA et image Open Graph : `python scripts/generate-assets.py` (Pillow).

### Confidentialité

Aucun backend, aucun compte, aucune statistique. Les données restent dans le navigateur
(`localStorage`) ; seuls les tickers détenus sont envoyés à CoinGecko puis Coinbase pour les prix.
Sauvegarde/restauration JSON dans les réglages.

## Licence

MIT — voir [LICENSE](LICENSE).
