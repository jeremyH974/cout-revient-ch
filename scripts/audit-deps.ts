#!/usr/bin/env node
/**
 * `npm audit` des dépendances de production — insensible aux pannes du registre, **jamais** aux
 * vulnérabilités.
 *
 * Le 04/09/2026, l'étape a fait échouer trois exécutions en trois heures (PR #61, puis deux fois
 * `main`, bloquant le déploiement) sans qu'aucune vulnérabilité soit en cause : le point d'entrée
 * `security/advisories/bulk` du registre a répondu un délai dépassé, puis un `503`. `npm audit`
 * sort en **1 dans les deux cas** et son code de sortie ne les distingue pas.
 *
 * C'est exactement la confusion tranchée par la décision n° 98 : **une non-réponse n'est pas une
 * rupture de contrat**. On la lève ici de la même façon — en regardant ce que le service a rendu,
 * pas seulement le fait qu'il a échoué :
 *
 * - `{ "error": … }` dans la sortie JSON, ou pas de JSON du tout → le service n'a rien dit :
 *   **on réessaie**, et l'échec final nomme la panne au lieu d'accuser une dépendance ;
 * - `metadata.vulnerabilities` → le service a rendu un verdict : **on ne réessaie pas**, on
 *   échoue tout de suite. Rejouer un verdict ne ferait que retarder le constat, et une alerte de
 *   sécurité qu'on absorbe est pire que pas d'alerte du tout.
 *
 * L'alternative — `continue-on-error` sur l'étape — rendrait l'audit décoratif : il passerait au
 * vert le jour où il aurait dû crier. Elle est écartée pour cette seule raison.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Trois essais : deux pauses courtes suffisent à passer un `503` de quelques secondes. */
const ATTEMPTS = 3;
const PAUSES_MS = [10_000, 30_000];
/** Repli si la table de pauses est plus courte que le nombre d'essais. */
const LAST_PAUSE_MS = 30_000;

/**
 * Délai de récupération abaissé à 60 s (défaut npm : 300 s). Un audit qui attend cinq minutes par
 * essai transforme une panne passagère en quart d'heure de CI ; `--fetch-retries=1` laisse à npm
 * son propre réessai, sans empiler les deux boucles.
 */
const AUDIT_ARGS = [
  'audit',
  '--omit=dev',
  '--audit-level=high',
  '--json',
  '--fetch-timeout=60000',
  '--fetch-retries=1',
];

/** Ce que le registre a répondu, indépendamment du code de sortie. */
export type AuditVerdict = 'clean' | 'vulnerable' | 'unreachable';

/** Les seuls champs du rapport `npm audit --json` dont dépend la décision. */
interface AuditReport {
  error?: { code?: string; summary?: string; detail?: string };
  metadata?: { vulnerabilities?: Record<string, number> };
}

/**
 * `clean` : aucune vulnérabilité au niveau demandé. `vulnerable` : verdict rendu, il y en a.
 * `unreachable` : le service n'a rien rendu d'exploitable — panne de transport, pas verdict.
 */
export function classify(exitCode: number, stdout: string): AuditVerdict {
  let report: AuditReport | null;
  try {
    report = JSON.parse(stdout) as AuditReport;
  } catch {
    report = null;
  }
  // Pas de document : rien à interpréter. Même en sortie 0, un audit muet n'est pas un audit vert.
  if (report === null || typeof report !== 'object') return 'unreachable';
  // npm rend `{ error: { code, summary, detail } }` quand le point d'entrée refuse de répondre.
  if (report.error) return 'unreachable';
  const counts = report.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') return 'unreachable';
  return exitCode === 0 ? 'clean' : 'vulnerable';
}

/** Résumé lisible d'un verdict, pour que le journal de CI dise quoi corriger. */
export function summarize(stdout: string): string {
  try {
    const counts: Record<string, number> =
      (JSON.parse(stdout) as AuditReport).metadata?.vulnerabilities ?? {};
    const notable = ['critical', 'high', 'moderate', 'low']
      .filter((level) => (counts[level] ?? 0) > 0)
      .map((level) => `${counts[level]} ${level}`);
    return notable.length > 0 ? notable.join(', ') : 'aucune';
  } catch {
    return 'illisible';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<number> {
  let last: { verdict: AuditVerdict; stdout: string; stderr: string } = {
    verdict: 'unreachable',
    stdout: '',
    stderr: '',
  };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const pause = PAUSES_MS[attempt - 1] ?? LAST_PAUSE_MS;
      console.log(`Registre npm muet : nouvel essai dans ${pause / 1000} s…`);
      await sleep(pause);
    }
    // `npm.cmd` sous Windows, jamais `shell: true` : passer des arguments à un shell les
    // concatène sans les échapper (Node DEP0190), et un audit n'a aucune raison de le demander.
    const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', AUDIT_ARGS, {
      encoding: 'utf8',
    });
    const stdout = run.stdout ?? '';
    const verdict = classify(run.status ?? 1, stdout);
    last = { verdict, stdout, stderr: run.stderr ?? '' };
    if (verdict === 'clean') {
      console.log('Audit des dépendances de production : aucune vulnérabilité au niveau « high ».');
      return 0;
    }
    if (verdict === 'vulnerable') {
      console.error(`Vulnérabilités dans les dépendances de production : ${summarize(stdout)}.`);
      console.error('Détail : npm audit --omit=dev --audit-level=high');
      return 1;
    }
  }
  console.error(
    `Le registre npm n'a rien rendu d'exploitable après ${ATTEMPTS} essais : ce n'est pas un ` +
      `verdict de sécurité, c'est une panne de service. Relancez le job ; si elle dure, ` +
      `regardez status.npmjs.org.`,
  );
  if (last.stderr.trim()) console.error(last.stderr.trim().split('\n').slice(-3).join('\n'));
  return 1;
}

const entry = process.argv[1];
const isMain = entry !== undefined && pathToFileURL(entry).href === import.meta.url;
if (isMain) process.exit(await main());
