// Échoue si un export personnel suivi par git se trouve hors de tests/fixtures/.
// Protège contre le commit accidentel d'un relevé de courtier : export CSV Coinhouse, mais aussi
// classeur Excel — c'est le format du relevé eToro, et lui seul portait un trou jusqu'au 06/09/2026.
// Et la SAUVEGARDE de l'app, qui n'est pas un relevé mais contient tout ce qu'un relevé contient,
// et davantage : elle n'était couverte ni ici ni par `.gitignore` jusqu'au 20/09/2026.
import { execSync } from 'node:child_process';

/**
 * Motifs d'un export personnel. Le tableur compte autant que le CSV, et la sauvegarde JSON de
 * l'app autant que les deux : `cout-revient-ch-sauvegarde-<date>.json`, éventuellement préfixée
 * `demo-` ou suffixée `-chiffree`. La fixture gelée porte un autre nom (`backup-v1.json`).
 */
const PATTERNS = ['*.csv', '*.xlsx', '*.xls', '*.xlsm', '*cout-revient-ch-sauvegarde*.json'];

const tracked = execSync(`git ls-files -- ${PATTERNS.map((p) => `"${p}"`).join(' ')}`, {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
const offenders = tracked.filter((file) => !file.startsWith('tests/fixtures/'));

if (offenders.length > 0) {
  console.error('ERREUR : export(s) personnel(s) suivi(s) par git :');
  for (const file of offenders) console.error(`  - ${file}`);
  console.error('Seules les fixtures synthétiques dans tests/fixtures/ sont autorisées.');
  process.exit(1);
}
console.log(`OK : ${tracked.length} export(s) suivi(s), tous dans tests/fixtures/.`);
