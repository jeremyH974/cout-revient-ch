# Politique de sécurité

L'application est un site statique qui tourne entièrement dans le navigateur : aucun serveur ne
reçoit vos données, aucun compte n'existe. Les seules requêtes sortantes vont vers les fournisseurs
de prix et de taux de change listés dans la page Confidentialité de l'application.

## Signaler une vulnérabilité

- De préférence via le signalement privé GitHub : onglet **Security** du dépôt → **Report a
  vulnerability** (s'il est activé).
- Sinon, ouvrez une issue **sans détail exploitable** en demandant un canal privé.

Ne joignez jamais d'export Coinhouse ni de sauvegarde JSON réels.

## Périmètre et pratiques

- Dépendances installées sans scripts et après un délai de 7 jours (`.npmrc`), Dependabot avec délai,
  actions GitHub épinglées par empreinte de commit, CodeQL, revue des dépendances et OpenSSF
  Scorecard (voir `docs/DECISIONS.md`, décision 13).
- Content Security Policy stricte injectée au build (`default-src 'self'`, fournisseurs de données
  explicitement listés), aucun CDN.
- Les versions publiées correspondent au dernier commit de `main` déployé par GitHub Actions.
