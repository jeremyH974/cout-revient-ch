/**
 * L'étape `npm audit` de la CI a fait échouer trois exécutions en trois heures le 04/09/2026 —
 * jamais pour une vulnérabilité : le point d'entrée `security/advisories/bulk` du registre npm a
 * rendu un délai dépassé, puis un `503`. `npm audit` sort en **1 dans les deux cas**.
 *
 * Ce qui est vérifié ici est donc la seule chose qui compte : que le script **lise ce que le
 * service a rendu** au lieu de lire son seul code de sortie — un verdict échoue tout de suite, une
 * non-réponse se réessaie (décision n° 99, qui applique à la CI la règle de la n° 98).
 */
import { describe, expect, it } from 'vitest';
import { classify, npmInvocation, outcome, summarize } from '../../scripts/audit-deps.ts';

/** Ce que npm rend quand tout va bien : un rapport complet, aucune vulnérabilité, sortie 0. */
const CLEAN = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
});

/** Un vrai verdict : le service a parlé, et il faut agir. */
const VULNERABLE = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: { 'some-package': { severity: 'high', via: ['CVE-2026-0000'] } },
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 2, critical: 0, total: 3 } },
});

/** Ce que npm rend quand le point d'entrée refuse : un objet d'erreur, et rien à valider. */
const ENDPOINT_ERROR = JSON.stringify({
  error: {
    code: 'ENOAUDIT',
    summary: 'audit endpoint returned an error',
    detail: '503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/…',
  },
});

describe('classification de la réponse de `npm audit`', () => {
  it('rapport complet et sortie 0 : aucune vulnérabilité', () => {
    expect(classify(0, CLEAN)).toBe('clean');
  });

  it('rapport complet et sortie 1 : un verdict, qu’on ne rejoue pas', () => {
    expect(classify(1, VULNERABLE)).toBe('vulnerable');
  });

  it('objet d’erreur : une panne de service, pas un verdict', () => {
    // C'est le cas exact du 04/09/2026 — celui qui a bloqué un déploiement trois fois.
    expect(classify(1, ENDPOINT_ERROR)).toBe('unreachable');
  });

  it('sortie illisible ou vide : rien à interpréter, donc pas de verdict', () => {
    expect(classify(1, '')).toBe('unreachable');
    expect(classify(1, 'npm error audit endpoint returned an error')).toBe('unreachable');
    expect(classify(1, '{"auditReportVersion":2}')).toBe('unreachable');
  });

  it('un audit muet n’est pas un audit vert, même en sortie 0', () => {
    // Sans compteurs, une sortie 0 ne prouve rien : elle serait le pire des faux verts.
    expect(classify(0, '')).toBe('unreachable');
    expect(classify(0, '{"error":{"code":"ENOAUDIT"}}')).toBe('unreachable');
  });
});

describe('résumé lisible du verdict', () => {
  it('énumère les niveaux non nuls, du plus grave au moins grave', () => {
    expect(summarize(VULNERABLE)).toBe('2 high, 1 low');
  });

  it('dit « aucune » sur un rapport propre, « illisible » sur un non-rapport', () => {
    expect(summarize(CLEAN)).toBe('aucune');
    expect(summarize('pas du JSON')).toBe('illisible');
  });
});

/**
 * Sous Windows, le script lançait `npm.cmd` sans shell, ce que Node refuse depuis le correctif de
 * CVE-2024-27980 : `EINVAL`, aucune sortie — pris pour un registre muet. Constaté le 22/09/2026 :
 * `npm run audit:prod` n'y avait jamais rendu de verdict, et accusait le registre à chaque fois.
 */
describe('lancer npm sans shell, sous tous les systèmes', () => {
  const NODE = String.raw`C:\Program Files\nodejs\node.exe`;
  const CLI = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
  const nothing = (): boolean => false;

  it('sous `npm run`, le Node courant exécute le npm-cli.js que npm désigne', () => {
    expect(npmInvocation({ npm_execpath: CLI }, 'win32', NODE, nothing)).toEqual({
      command: NODE,
      prefix: [CLI],
    });
  });

  it('sous Windows hors `npm run`, le npm-cli.js posé à côté de node', () => {
    expect(npmInvocation({}, 'win32', NODE, (path) => path === CLI)).toEqual({
      command: NODE,
      prefix: [CLI],
    });
  });

  it('jamais un `.cmd` : Node refuse de le lancer sans shell', () => {
    for (const env of [{}, { npm_execpath: CLI }])
      for (const platform of ['win32', 'linux', 'darwin'])
        for (const exists of [nothing, (path: string) => path === CLI])
          expect(npmInvocation(env, platform, NODE, exists).command).not.toMatch(/\.cmd$/i);
  });

  it('un `npm_execpath` qui n’est pas npm (pnpm, yarn) est ignoré', () => {
    const pnpm = { npm_execpath: '/usr/lib/node_modules/pnpm/bin/pnpm.cjs' };
    expect(npmInvocation(pnpm, 'linux', '/usr/bin/node', nothing)).toEqual({
      command: 'npm',
      prefix: [],
    });
  });

  it('ailleurs, `npm` du PATH, comme la CI l’a toujours fait', () => {
    expect(npmInvocation({}, 'linux', '/usr/bin/node', nothing)).toEqual({
      command: 'npm',
      prefix: [],
    });
  });
});

describe('un npm qui ne démarre pas', () => {
  it('n’est ni un verdict ni une panne du registre, et ne se réessaie pas', () => {
    // Le cas exact de Windows : `spawnSync` rend une erreur, pas de statut, pas de sortie.
    const einval = Object.assign(new Error('spawnSync npm.cmd EINVAL'), { code: 'EINVAL' });
    expect(outcome({ error: einval, status: null, stdout: '' })).toBe('not-started');
  });

  it('quand npm a démarré, la réponse du service décide, comme avant', () => {
    expect(outcome({ status: 0, stdout: CLEAN })).toBe('clean');
    expect(outcome({ status: 1, stdout: VULNERABLE })).toBe('vulnerable');
    expect(outcome({ status: 1, stdout: ENDPOINT_ERROR })).toBe('unreachable');
  });
});
