/**
 * Espace de stockage (`navigator.storage.estimate()`, P124) : des octets en `number` — jamais un
 * montant ni une quantité du domaine, donc hors de la règle « chaînes décimales + `Big` » — mis en
 * forme fr-FR comme le reste de `src/lib/format`.
 */
const UNITS = ['octets', 'Ko', 'Mo', 'Go', 'To'] as const;

function intl(maxDp: number): Intl.NumberFormat {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: maxDp });
}

/**
 * `1 234 567` → « 1,18 Mo ». Base 1024, comme les valeurs que rend `estimate()` (Ko/Mo/Go usuels
 * des navigateurs, pas Ki/Mi/Gi) ; jamais de décimale en octets, deux sous 100 unités au-delà,
 * aucune passé ce seuil — inutile de distinguer 512,34 Mo de 512 Mo.
 */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const dp = unitIndex === 0 ? 0 : value < 100 ? 2 : 0;
  return `${intl(dp).format(value)} ${UNITS[unitIndex]}`;
}
