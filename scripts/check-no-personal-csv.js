// Échoue si un fichier .csv suivi par git se trouve hors de tests/fixtures/.
// Protège contre le commit accidentel d'un export Coinhouse personnel.
import { execSync } from 'node:child_process';

const tracked = execSync('git ls-files -- "*.csv"', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const offenders = tracked.filter((file) => !file.startsWith('tests/fixtures/'));

if (offenders.length > 0) {
  console.error('ERREUR : fichier(s) CSV personnel(s) suivi(s) par git :');
  for (const file of offenders) console.error(`  - ${file}`);
  console.error('Seules les fixtures anonymisées dans tests/fixtures/ sont autorisées.');
  process.exit(1);
}
console.log(`OK : ${tracked.length} CSV suivi(s), tous dans tests/fixtures/.`);
