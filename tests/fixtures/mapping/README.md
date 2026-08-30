# Fixtures d'appariement de colonnes (100 % synthétiques)

Trois fichiers écrits à la main pour P64, avec des montants inventés — **jamais dérivés d'un export
réel**, même « anonymisé » (docs/DECISIONS.md n° 17).

- `demo-inconnu.csv` — en-têtes **français inédits** qu'aucune table fermée ne reconnaît
  (« Horodatage », « Quantité vendue », « Contre-valeur (EUR) »), séparateur point-virgule, dates
  `jj/MM/aaaa`, décimales à virgule. C'est le cas nominal de la voie déterministe : les dix
  colonnes sont appariées **sans clé et sans réseau**, et deux libellés de type (« Récompense »,
  « Frais de retrait ») sont traduits vers les étiquettes du moteur. Sert aussi à l'E2E
  (`tests/e2e/import-mapping.spec.ts`).
- `demo-partiel.csv` — le même fichier, à ceci près que la colonne de description s'appelle
  « Zorglub » : un en-tête qu'aucun synonyme ne connaît, et dont la forme (`free-text`) ne dit
  rien. C'est le **trou** qu'un modèle peut légitimement combler, et le cas nominal du banc
  d'essai.
- `demo-opaque.csv` — quatre colonnes nommées `col_a`…`col_d` : deux montants, deux devises, sans
  aucun indice de sens. La voie déterministe refuse de trancher (deux prétendants pour chaque
  champ), et c'est ce fichier qui permet au banc d'essai d'éprouver le cas décisif — un appariement
  aux **jambes inversées**, parfaitement conforme au JSON, que seul le contrôle « aucune position
  bloquée » rejette.
