/**
 * Le banc d'essai des fonctions d'IA (P70) — le verdict en TROIS classes.
 *
 * - **Bloquant** (échec de CI) : un nombre non ancré, un mot proscrit, une étiquette absente, un
 *   contrat de refus violé. Ce sont les quatre choses qui rendraient une sortie de modèle
 *   publiable alors qu'elle ne devrait pas l'être.
 * - **À recapturer** (rapporté, vert) : cassette absente, ou `modelId` différent de celui de
 *   l'adaptateur. C'est ce qui distingue « la sortie est fausse » de « le modèle a changé » —
 *   confondre les deux ferait rougir la CI à chaque mise à jour de modèle, et on finirait par ne
 *   plus la lire.
 * - **Indicatif** (rapporté, vert) : longueur du texte, couverture des ancres citées. Utile à
 *   relire, jamais à faire échouer : un texte peut être court et juste, ou long et creux.
 *
 * **Aucun juge LLM.** Faire noter une sortie de modèle par un autre modèle importerait des biais
 * mesurés et non corrigés (position, auto-préférence) au cœur même du garde-fou. Tout ce qui est
 * bloquant ici est décidé par une fonction pure et rejouable.
 *
 * **Une seule cassette par cas** pour les douze écrits à la main : trois variantes rédigées par la
 * même personne seraient une fausse variance. La règle des trois tirages s'appliquera aux captures
 * réelles, avec P65 (voir `docs/ia-harnais.md`).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CASSETTE_SOURCES,
  MissingCassette,
  cassetteKey,
  parseCassette,
  recordedAdapter,
  type Cassette,
} from '../../src/lib/ai/adapters/recorded';
import { anchorCoverage, auditText, isAnchored, type AnchorReport } from '../../src/lib/ai/anchor';
import {
  AI_REFUSALS,
  accept,
  buildRequest,
  label,
  refuse,
  type AiOutcome,
  type AiRefusal,
  type AiTask,
  type ModelAdapter,
} from '../../src/lib/ai/contract';
import { ALL_LEXICONS, scanOutput, type LexiconHit } from '../../src/lib/format/lexicon';

const CASES_DIR = fileURLToPath(new URL('../fixtures/ai/cases/', import.meta.url));
const REPLIES_DIR = fileURLToPath(new URL('../fixtures/ai/replies/', import.meta.url));
const AI_DIR = fileURLToPath(new URL('../../src/lib/ai/', import.meta.url));

/** Instant fixe : le banc d'essai ne dépend jamais de l'heure à laquelle il tourne. */
const NOW = '2026-08-30T09:00:00';
const MODEL = 'handwritten/p70';

interface CaseSpec {
  readonly id: string;
  readonly task: AiTask;
  readonly input: unknown;
  readonly expect: {
    readonly anchored: boolean;
    readonly lexicon: boolean;
    readonly mustRefuse: AiRefusal | null;
  };
  /** Limite ASSUMÉE du vérificateur : le cas est vert, et il est étiqueté comme tel. */
  readonly knownLimitation?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCase(raw: unknown, file: string): CaseSpec {
  if (!isRecord(raw)) throw new Error(`${file} : un objet JSON est attendu`);
  const { id, task, input, expect: expected, knownLimitation } = raw;
  if (typeof id !== 'string' || id === '') throw new Error(`${file} : \`id\` manquant`);
  if (task !== 'narrative') throw new Error(`${file} : tâche « ${String(task)} » inconnue`);
  if (!isRecord(expected)) throw new Error(`${file} : \`expect\` manquant`);
  const { anchored, lexicon, mustRefuse } = expected;
  if (typeof anchored !== 'boolean' || typeof lexicon !== 'boolean')
    throw new Error(`${file} : \`anchored\` et \`lexicon\` doivent être des booléens`);
  if (mustRefuse !== null && !AI_REFUSALS.includes(mustRefuse as AiRefusal))
    throw new Error(`${file} : motif de refus « ${String(mustRefuse)} » inconnu`);
  return {
    id,
    task,
    input,
    expect: { anchored, lexicon, mustRefuse: mustRefuse as AiRefusal | null },
    ...(typeof knownLimitation === 'string' ? { knownLimitation } : {}),
  };
}

const CASE_FILES = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
const CASES: readonly CaseSpec[] = CASE_FILES.map((file) =>
  parseCase(JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')), file),
);

const CASSETTE_FILES = readdirSync(REPLIES_DIR).filter((f) => f.endsWith('.json'));
const CASSETTES: ReadonlyMap<string, Cassette> = new Map(
  CASSETTE_FILES.map((file) => {
    const cassette = parseCassette(JSON.parse(readFileSync(join(REPLIES_DIR, file), 'utf8')));
    return [cassette.hash, cassette] as const;
  }),
);

const ADAPTER = recordedAdapter(MODEL, CASSETTES);

/** Découpe en phrases : des numéros de ligne utiles dans le rapport de lexique. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?…:;])\s+/u);

type Verdict =
  | { readonly kind: 'recapture'; readonly why: string }
  | {
      readonly kind: 'evaluated';
      readonly outcome: AiOutcome<string>;
      readonly text: string | null;
      readonly audit: AnchorReport | null;
      readonly hits: readonly LexiconHit[];
    };

async function evaluateCase(spec: CaseSpec, adapter: ModelAdapter | null): Promise<Verdict> {
  if (adapter === null) {
    return {
      kind: 'evaluated',
      outcome: refuse<string>(spec.task, 'no-model'),
      text: null,
      audit: null,
      hits: [],
    };
  }
  let reply;
  try {
    reply = await adapter.complete(buildRequest(spec.task, spec.input));
  } catch (error) {
    if (error instanceof MissingCassette)
      return { kind: 'recapture', why: `cassette absente : ${error.hash}` };
    throw error;
  }
  if (reply.modelId !== adapter.id)
    return { kind: 'recapture', why: `modèle enregistré « ${reply.modelId} » ≠ « ${adapter.id} »` };
  const audit = auditText(reply.text, spec.input);
  const hits = scanOutput(sentencesOf(reply.text), ALL_LEXICONS);
  const outcome =
    hits.length > 0
      ? refuse<string>(spec.task, 'forbidden-lexicon')
      : accept(spec.task, reply.text, label(reply.modelId, NOW), audit);
  return { kind: 'evaluated', outcome, text: reply.text, audit, hits };
}

const recaptures: string[] = [];
const indicative: string[] = [];

describe('registre du jeu de référence', () => {
  it('porte des identifiants uniques, et autant de fichiers que de cas', () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size, `identifiant dupliqué dans ${ids.join(', ')}`).toBe(ids.length);
    expect(CASES).toHaveLength(CASE_FILES.length);
    expect(CASES.length).toBeGreaterThanOrEqual(14);
  });

  it('nomme chaque fichier de cas d’après son identifiant', () => {
    for (const spec of CASES) expect(CASE_FILES).toContain(`${spec.id}.json`);
  });

  it('donne à chaque cassette une provenance déclarée, et rien d’autre', () => {
    // Un test refuse toute autre valeur : c'est la seule barrière entre le dépôt et une capture
    // faite sur un export réel (décision n° 17).
    for (const cassette of CASSETTES.values()) {
      expect(CASSETTE_SOURCES, cassette.hash).toContain(cassette.source);
    }
    expect(CASSETTES.size).toBe(CASSETTE_FILES.length);
  });

  it('nomme chaque cassette d’après son empreinte, et n’en garde aucune orpheline', () => {
    for (const cassette of CASSETTES.values())
      expect(CASSETTE_FILES).toContain(`${cassette.hash}.json`);
    const used = new Set(
      CASES.map((spec) => cassetteKey(buildRequest(spec.task, spec.input), MODEL)),
    );
    for (const hash of CASSETTES.keys()) {
      expect(used, `cassette orpheline : ${hash}`).toContain(hash);
    }
  });

  it('donne à chaque cas une entrée distincte : sinon deux cas partageraient une cassette', () => {
    const keys = CASES.map((spec) => cassetteKey(buildRequest(spec.task, spec.input), MODEL));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('aucun chemin réseau dans le harnais', () => {
  it('ne contient ni fetch, ni socket, ni URL dans src/lib/ai', () => {
    // Les modules livrés, pas leurs tests : ceux-ci CITENT les mots interdits pour les surveiller.
    const files = readdirSync(AI_DIR, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    for (const file of files) {
      const source = readFileSync(join(AI_DIR, file), 'utf8');
      for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
        expect(source.includes(forbidden), `${file} contient ${forbidden}`).toBe(false);
      }
    }
  });
});

describe('verdict par cas', () => {
  for (const spec of CASES) {
    it(`${spec.id}${spec.knownLimitation === undefined ? '' : ' (limite connue)'}`, async () => {
      const adapter = spec.expect.mustRefuse === 'no-model' ? null : ADAPTER;
      const verdict = await evaluateCase(spec, adapter);

      if (verdict.kind === 'recapture') {
        // À RECAPTURER : rapporté, jamais bloquant. La sortie n'est pas jugée fausse, elle est
        // simplement absente ou périmée.
        recaptures.push(`${spec.id} — ${verdict.why}`);
        return;
      }

      const { outcome, audit, hits, text } = verdict;

      // BLOQUANT 1 et 2 : l'ancrage et le lexique.
      if (audit !== null) {
        const offending = audit.unanchored.map((u) => `${u.token.raw} → ${u.reason}`).join(' | ');
        expect(isAnchored(audit), `${spec.id} : ancrage — ${offending}`).toBe(spec.expect.anchored);
      }
      const said = hits.map((h) => `${h.why} — ${h.text}`).join(' | ');
      expect(hits.length === 0, `${spec.id} : lexique — ${said}`).toBe(spec.expect.lexicon);

      // BLOQUANT 3 et 4 : le contrat de refus et l'étiquette.
      if (spec.expect.mustRefuse === null) {
        expect(outcome.status, spec.id).toBe('ok');
        if (outcome.status === 'ok') {
          expect(outcome.label.generated, spec.id).toBe(true);
          expect(outcome.label.modelId, spec.id).toBe(MODEL);
          expect(outcome.label.notice.length, spec.id).toBeGreaterThan(20);
          expect(outcome.audit.unanchored, spec.id).toEqual([]);
        }
      } else {
        expect(outcome.status, spec.id).toBe('refused');
        if (outcome.status === 'refused') {
          expect(outcome.reason, spec.id).toBe(spec.expect.mustRefuse);
          expect(outcome.fallback, spec.id).toBe('deterministic');
        }
      }

      // INDICATIF : rapporté, jamais bloquant.
      if (text !== null && audit !== null) {
        indicative.push(
          `${spec.id} — ${text.length} caractères, ` +
            `couverture ${(anchorCoverage(audit) * 100).toFixed(0)} %, ` +
            `${audit.checked.length} nombres contrôlés, ${audit.excluded.length} écartés`,
        );
      }
    });
  }
});

describe('les deux limites connues sont étiquetées, pas seulement racontées', () => {
  it('déclare au moins deux cas verts qui portent une limite du vérificateur', () => {
    const limits = CASES.filter((c) => c.knownLimitation !== undefined);
    expect(limits.length).toBeGreaterThanOrEqual(2);
    for (const spec of limits) {
      expect(spec.expect.anchored, spec.id).toBe(true);
      expect(spec.expect.mustRefuse, spec.id).toBeNull();
      expect((spec.knownLimitation ?? '').length, spec.id).toBeGreaterThan(40);
    }
  });
});

describe('rapport du banc d’essai', () => {
  it('récapitule ce qui est à recapturer et ce qui est indicatif', () => {
    // Ces deux listes ne font jamais échouer la CI : elles se lisent.
    console.info(
      [
        '',
        `Banc d'essai IA — ${CASES.length} cas, ${CASSETTES.size} cassettes.`,
        `À recapturer : ${recaptures.length === 0 ? 'aucun' : ''}`,
        ...recaptures.map((line) => `  · ${line}`),
        'Indicatif :',
        ...indicative.map((line) => `  · ${line}`),
      ].join('\n'),
    );
    expect(recaptures.length + indicative.length).toBeGreaterThan(0);
  });
});

describe('la classe « à recapturer » existe vraiment', () => {
  // Sans ce test, rien ne prouverait que le harnais sait distinguer une sortie fausse d'un modèle
  // qui a changé : les cassettes du dépôt sont toutes présentes et à jour.
  it('signale une cassette absente sans faire échouer la CI', async () => {
    const spec = CASES[0];
    if (spec === undefined) throw new Error('jeu de référence vide');
    const verdict = await evaluateCase(spec, recordedAdapter(MODEL, new Map()));
    expect(verdict.kind).toBe('recapture');
  });

  it('signale un modelId différent de celui de l’adaptateur', async () => {
    const spec = CASES[0];
    if (spec === undefined) throw new Error('jeu de référence vide');
    const hash = cassetteKey(buildRequest(spec.task, spec.input), MODEL);
    const stale: Cassette = {
      hash,
      modelId: 'un-autre-modele',
      capturedAt: NOW,
      source: 'fixture-capture',
      text: 'Peu importe.',
    };
    const verdict = await evaluateCase(spec, recordedAdapter(MODEL, new Map([[hash, stale]])));
    expect(verdict.kind).toBe('recapture');
    if (verdict.kind === 'recapture') expect(verdict.why).toContain('un-autre-modele');
  });
});
