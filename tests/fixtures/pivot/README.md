# Fixtures pivot (100 % synthétiques)

Deux fichiers de démonstration du format pivot (décision n° 24), écrits à la main avec des
montants inventés — jamais dérivés d'un export réel (décision n° 17) :

- `demo-exchange.csv` — variante « export Koinly » (colonnes From/To + Tag), telle que produite
  par Koinly (Transactions → Bulk edit → Export) et lue par Waltio : un achat EUR→BTC avec frais,
  un échange BTC→ETH valorisé par Net Worth, une vente ETH→USDC avec frais en USDC, un envoi
  de BTC vers le portefeuille froid (`TxHash` partagé avec la réception ci-dessous).
- `demo-ledger.csv` — variante « Custom CSV Universal » (colonnes Sent/Received) : la réception
  du virement (0,0199 BTC, frais réseau 0,0001) et une récompense de staking étiquetée `staking`.

Importés dans deux comptes distincts, ils déclenchent l'appariement automatique du virement
interne (fenêtre 72 h, écart ≤ 2 %) : voir `tests/e2e/pivot-import.spec.ts`.
