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
import { join, sep } from 'node:path';
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
  buildRequest,
  refuse,
  refusalOrigin,
  type AiOutcome,
  type AiRefusal,
  type AiTask,
  type ModelAdapter,
} from '../../src/lib/ai/contract';
import { judgeMapping, parseMappingReply } from '../../src/lib/ai/mapping';
import { judgeNarrative, refusalOfModelError, sentencesOf } from '../../src/lib/ai/narrative';
import { parseCsvText } from '../../src/lib/import/csv';
import { TYPE_TARGETS } from '../../src/lib/import/mapping/labels';
import { mergeModelMapping, type ModelMapping } from '../../src/lib/import/mapping/merge';
import { buildColumnMappingInput } from '../../src/lib/import/mapping/payload';
import { confirmedMapping, proposeMapping } from '../../src/lib/import/mapping/propose';
import { contextOf, firstFailure, verifyMapping } from '../../src/lib/import/mapping/verify';
import type { ColumnMappingInput } from '../../src/lib/import/mapping/payload';
import { ALL_LEXICONS, scanOutput, type LexiconHit } from '../../src/lib/format/lexicon';
import { ANTHROPIC_MODEL_ID } from '../../src/lib/net/anthropic';
import { ANTHROPIC_HOST } from '../../src/lib/net/anthropic';

const CASES_DIR = fileURLToPath(new URL('../fixtures/ai/cases/', import.meta.url));
const REPLIES_DIR = fileURLToPath(new URL('../fixtures/ai/replies/', import.meta.url));
const MAPPING_DIR = fileURLToPath(new URL('../fixtures/mapping/', import.meta.url));
const AI_DIR = fileURLToPath(new URL('../../src/lib/ai/', import.meta.url));

/** Taux EUR/USD fixe : le banc d'essai ne dépend d'aucun taux réel, comme il ne dépend d'aucune heure. */
const USD_RATE = (): string => '1.1';

/** Instant fixe : le banc d'essai ne dépend jamais de l'heure à laquelle il tourne. */
const NOW = '2026-08-30T09:00:00';

/**
 * Deux identités de modèle, et il en faut deux.
 *
 * `MODEL` est une fiction : les douze cassettes écrites à la main ne viennent d'aucun modèle, et
 * leur mentir un identifiant réel serait le premier pas vers une capture qu'on ne saurait plus
 * distinguer d'une rédaction. `CAPTURED_MODEL` est le vrai modèle, celui que `npm run ai:capture`
 * interroge : une cassette capturée porte donc une autre empreinte (le modèle entre dans la clé),
 * et le banc d'essai la préfère dès qu'elle existe. Avant la première capture, tout retombe sur les
 * cassettes manuscrites — sans rien signaler, parce qu'il n'y a rien à signaler.
 */
const MODEL = 'handwritten/p70';
const CAPTURED_MODEL = ANTHROPIC_MODEL_ID;

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
  /**
   * `column-mapping` seulement : le fichier synthétique sur lequel le vérificateur rejoue l'import
   * (`tests/fixtures/mapping/`). Il ne voyage JAMAIS vers le modèle — la charge utile est
   * `input`, et elle ne porte aucune cellule. C'est justement ce que le cas éprouve.
   */
  readonly csv?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCase(raw: unknown, file: string): CaseSpec {
  if (!isRecord(raw)) throw new Error(`${file} : un objet JSON est attendu`);
  const { id, task, input, expect: expected, knownLimitation, csv } = raw;
  if (typeof id !== 'string' || id === '') throw new Error(`${file} : \`id\` manquant`);
  if (task !== 'narrative' && task !== 'column-mapping')
    throw new Error(`${file} : tâche « ${String(task)} » inconnue`);
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
    ...(typeof csv === 'string' ? { csv } : {}),
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
const CAPTURED_ADAPTER = recordedAdapter(CAPTURED_MODEL, CASSETTES);

/** La clé d'un cas pour un modèle donné : c'est elle qui nomme le fichier de cassette. */
const keyOf = (spec: CaseSpec, modelId: string): string =>
  cassetteKey(buildRequest(spec.task, spec.input), modelId);

/**
 * La cassette capturée l'emporte sur la manuscrite. C'est la seule façon pour `npm run ai:capture`
 * d'avoir un effet : il écrit sous l'empreinte du VRAI modèle, et le banc d'essai bascule dessus
 * de lui-même, sans qu'on touche à un test.
 */
const recordedFor = (spec: CaseSpec): ModelAdapter =>
  CASSETTES.has(keyOf(spec, CAPTURED_MODEL)) ? CAPTURED_ADAPTER : ADAPTER;

/**
 * Un modèle qui échoue **avec son motif**, pour les cas qui éprouvent le contrat de refus plutôt
 * qu'une sortie de texte : clé invalide, plafond atteint, délai dépassé, réponse vide ou tronquée.
 *
 * Ces états ne peuvent pas venir d'une cassette : `parseCassette` refuse un texte vide, et une
 * cassette ne porte ni code HTTP ni délai. Ils viennent donc d'un adaptateur qui rejette comme le
 * fait l'adaptateur réseau — même forme d'erreur, `aiRefusal` compris. Le banc d'essai éprouve
 * ainsi le pipeline entier, y compris ses branches d'échec, sans qu'aucun test ne touche au réseau.
 */
function failingAdapter(reason: AiRefusal): ModelAdapter {
  return {
    id: MODEL,
    complete: () =>
      Promise.reject(Object.assign(new Error(`échec simulé : ${reason}`), { aiRefusal: reason })),
  };
}

/**
 * Quel modèle pour quel cas. La règle suit l'ORIGINE du refus attendu (`refusalOrigin`) : ce que
 * le modèle n'a pas dit vient d'un adaptateur en échec, ce que nous avons rejeté vient d'une
 * cassette qu'il faut bien avoir lue pour la rejeter. `empty` fait exception et rejoint la
 * première famille, faute de pouvoir enregistrer une cassette vide.
 */
function adapterFor(spec: CaseSpec): ModelAdapter | null {
  const reason = spec.expect.mustRefuse;
  if (reason === null) return recordedFor(spec);
  if (reason === 'no-model') return null;
  if (reason === 'empty') return failingAdapter(reason);
  return refusalOrigin(reason) === 'model-unavailable' ? failingAdapter(reason) : recordedFor(spec);
}

type Verdict =
  | { readonly kind: 'recapture'; readonly why: string }
  | {
      readonly kind: 'evaluated';
      readonly outcome: AiOutcome<unknown>;
      readonly text: string | null;
      readonly audit: AnchorReport | null;
      readonly hits: readonly LexiconHit[];
    };

/**
 * Le vérificateur RÉEL d'un cas d'appariement : proposition déterministe du fichier synthétique,
 * fusion de ce que le modèle propose (contrôle 5 : il ne peut que combler un trou), puis rejeu de
 * l'import entier. Rend `null` s'il accepte, ou le code du premier contrôle en échec.
 */
function mappingVerifier(spec: CaseSpec): (model: ModelMapping) => string | null {
  const file = spec.csv;
  if (file === undefined) throw new Error(`${spec.id} : \`csv\` manquant pour un appariement`);
  const table = parseCsvText(readFileSync(join(MAPPING_DIR, file), 'utf8'));
  const proposal = proposeMapping(table);
  return (model) => {
    const merged = mergeModelMapping(proposal, model);
    const verdict = verifyMapping(
      confirmedMapping(merged.proposal),
      contextOf(table, proposal, USD_RATE),
    );
    return verdict.ok ? null : (firstFailure(verdict)?.code ?? 'refus sans code');
  };
}

async function evaluateCase(spec: CaseSpec, adapter: ModelAdapter | null): Promise<Verdict> {
  if (adapter === null) {
    return {
      kind: 'evaluated',
      outcome: refuse<unknown>(spec.task, 'no-model'),
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
    // Un échec porteur de son motif : le chemin réel du pipeline, éprouvé sans réseau.
    return {
      kind: 'evaluated',
      outcome: refuse<unknown>(spec.task, refusalOfModelError(error)),
      text: null,
      audit: null,
      hits: [],
    };
  }
  if (reply.modelId !== adapter.id)
    return { kind: 'recapture', why: `modèle enregistré « ${reply.modelId} » ≠ « ${adapter.id} »` };
  if (spec.task === 'column-mapping') {
    /*
     * P64. Le jugement passe par le PIPELINE LIVRÉ (`judgeMapping`), et son vérificateur est le
     * vrai : il rejoue l'import entier du fichier synthétique. C'est ce qui permet au cas
     * « jambes inversées » d'être conforme au JSON et refusé quand même — le seul cas du jeu de
     * référence où le contrôle qui mord n'est ni la forme, ni le vocabulaire, mais le moteur.
     */
    const outcome = judgeMapping(
      reply.text,
      spec.input as ColumnMappingInput,
      TYPE_TARGETS,
      reply.modelId,
      NOW,
      mappingVerifier(spec),
    );
    return { kind: 'evaluated', outcome, text: reply.text, audit: null, hits: [] };
  }
  /*
   * Le verdict vient du PIPELINE LIVRÉ (`judgeNarrative`), plus d'une réimplémentation locale.
   * C'était la faiblesse discrète du banc d'essai : il vérifiait sa propre copie des règles, donc
   * un pipeline qui aurait oublié le lexique serait resté vert. L'audit et les occurrences sont
   * recalculés ensuite pour le RAPPORT seulement — fonctions pures, aucun appel de plus.
   */
  const outcome = judgeNarrative(reply.text, spec.input, reply.modelId, NOW);
  const audit = auditText(reply.text, spec.input);
  const hits = scanOutput(sentencesOf(reply.text), ALL_LEXICONS);
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
    // Les deux identités : une cassette capturée est légitime, elle porte simplement l'empreinte
    // du vrai modèle. Ce qui reste interdit, c'est la cassette qu'aucun cas ne réclame.
    const used = new Set(
      CASES.flatMap((spec) => [keyOf(spec, MODEL), keyOf(spec, CAPTURED_MODEL)]),
    );
    for (const hash of CASSETTES.keys()) {
      expect(used, `cassette orpheline : ${hash}`).toContain(hash);
    }
  });

  it('donne à chaque cas une entrée distincte : sinon deux cas partageraient une cassette', () => {
    const keys = CASES.map((spec) => keyOf(spec, MODEL));
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * P64 : l'entrée écrite dans le cas doit être **exactement** celle que produit le code livré sur
   * le fichier synthétique. Sans ce contrôle, une évolution de la charge utile laisserait les cas
   * intacts et verts — ils éprouveraient un envoi que l'application ne fait plus. Un échec ici
   * n'est pas une régression : c'est un cas à régénérer, et le message le dit.
   */
  it('fige la charge utile réelle des cas d’appariement, fichier par fichier', () => {
    for (const spec of CASES) {
      if (spec.csv === undefined) continue;
      const table = parseCsvText(readFileSync(join(MAPPING_DIR, spec.csv), 'utf8'));
      const rebuilt = buildColumnMappingInput(table, proposeMapping(table)).input;
      expect(
        spec.input,
        `${spec.id} : la charge utile a changé — régénérez le cas et sa cassette`,
      ).toEqual(rebuilt);
    }
  });

  it('n’envoie AUCUNE cellule des fichiers d’appariement dans la charge utile des cas', () => {
    // La preuve de non-fuite vit dans `payload.property.test.ts` ; ici on la constate sur les cas
    // committés eux-mêmes, qui sont ce qui partirait réellement vers un modèle.
    for (const spec of CASES) {
      if (spec.csv === undefined) continue;
      const table = parseCsvText(readFileSync(join(MAPPING_DIR, spec.csv), 'utf8'));
      const sent = JSON.stringify(spec.input);
      const labels = new Set((spec.input as ColumnMappingInput).typesDistincts);
      for (const row of table.rows) {
        for (const cell of row) {
          const value = cell.trim();
          // Deux exceptions, et elles sont déclarées : les libellés de type (la seule donnée de
          // cellule qui voyage) et les valeurs qui figurent déjà dans un EN-TÊTE — « EUR » est une
          // cellule de ce fichier autant qu'un morceau de « Contre-valeur (EUR) », et l'en-tête,
          // lui, part légitimement. La version forte de la propriété, immunisée contre cette
          // coïncidence par des sentinelles, vit dans `import/mapping/payload.property.test.ts`.
          if (value === '' || labels.has(value.toLowerCase())) continue;
          if (table.header.some((h) => h.includes(value))) continue;
          expect(sent, `${spec.id} : « ${value} »`).not.toContain(value);
        }
      }
    }
  });

  it('n’écrit aucun caractère invisible en clair : ils sont échappés dans le fichier', () => {
    /*
     * Espace fine insécable, espace insécable, espace fine, moins typographique. Une cassette qui
     * éprouve le séparateur des milliers ressemblerait, à l'œil, à une cassette qui éprouve
     * l'espace ordinaire : la relecture ne pourrait rien y voir, et une régression du séparateur
     * passerait pour un fichier inchangé. La convention était écrite dans `docs/ia-harnais.md`
     * sans être vérifiée nulle part — un simple `JSON.stringify` suffisait à la défaire.
     */
    const invisible = /[\u00a0\u202f\u2009\u2212]/;
    for (const file of CASSETTE_FILES) {
      const raw = readFileSync(join(REPLIES_DIR, file), 'utf8');
      expect(invisible.test(raw), `${file} contient un caractère invisible en clair`).toBe(false);
    }
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

  /**
   * Le miroir du test ci-dessus, et il est aussi important que lui. Le premier dit « le harnais ne
   * sait pas parler au réseau » ; celui-ci dit « **un seul** fichier sait où appeler ». Sans lui,
   * un second appel écrit ailleurs — dans un composant, dans un script — échapperait à la revue,
   * au classement des erreurs et à la feuille de consentement, tout en restant parfaitement
   * conforme au premier test.
   *
   * Deux fichiers ont le droit d'écrire cette origine, et ils se surveillent l'un l'autre :
   * l'adaptateur qui la contacte, et la table qui l'autorise (décision n° 57).
   */
  it('un seul fichier du code livré écrit l’origine du modèle, plus la table qui l’autorise', () => {
    // Trois fichiers ont le droit de nommer l'hôte, et pour trois raisons distinctes :
    // l'adaptateur l'appelle, la table des origines l'autorise dans la CSP, et l'écran Vie privée
    // l'AFFICHE à l'utilisateur — dire où vont les données est la raison d'être de cet écran.
    const ALLOWED = [
      'src/lib/net/anthropic.ts',
      'src/lib/support/csp.ts',
      'src/routes/Privacy.svelte',
    ];
    const found: string[] = [];
    // `scripts` est inclus : le script de capture appelle le vrai modèle, et il doit passer par
    // l'adaptateur — pas réécrire l'URL, où elle échapperait au classement des erreurs.
    for (const dir of ['src', 'public', 'scripts']) {
      const base = fileURLToPath(new URL(`../../${dir}/`, import.meta.url));
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        const scanned =
          (entry.name.endsWith('.ts') ||
            entry.name.endsWith('.svelte') ||
            entry.name.endsWith('.js')) &&
          !entry.name.endsWith('.test.ts');
        if (!entry.isFile() || !scanned) continue;
        const path = join(entry.parentPath, entry.name);
        // L'hôte vient de l'adaptateur, jamais réécrit ici : une source unique de vérité, et
        // le test suit automatiquement si l'origine change un jour.
        if (!readFileSync(path, 'utf8').includes(ANTHROPIC_HOST)) continue;
        found.push(`${dir}/${path.slice(base.length).split(sep).join('/')}`);
      }
    }
    expect(found.sort()).toEqual(ALLOWED);
  });
});

describe('verdict par cas', () => {
  for (const spec of CASES) {
    it(`${spec.id}${spec.knownLimitation === undefined ? '' : ' (limite connue)'}`, async () => {
      const adapter = adapterFor(spec);
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
          expect(outcome.label.modelId, spec.id).toBe(adapter?.id);
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
      } else if (text !== null && spec.task === 'column-mapping') {
        const payload = spec.input as ColumnMappingInput;
        indicative.push(
          `${spec.id} — ${payload.colonnes.length} colonnes décrites, ` +
            `${payload.typesDistincts.length} libellé(s) de type envoyé(s), ` +
            `réponse de ${text.length} caractères`,
        );
      }
    });
  }
});

describe('P64 : le cas qui prouve que le vérificateur mord', () => {
  /**
   * `26-jambes-inversees` est le seul cas du jeu de référence où **tout est conforme sauf le
   * résultat** : le JSON est valide, les index existent, les champs sont déclarés, aucun doublon,
   * les dates se lisent, les montants aussi, les devises sont connues. Seul le moteur s'en
   * aperçoit — en essayant de céder des actifs jamais acquis.
   *
   * Le test ci-dessous ne se contente donc pas de vérifier que le cas est refusé : il vérifie
   * **par quel contrôle**. Un refus au contrôle 0 signifierait que la cassette est mal écrite, et
   * le cas ne prouverait plus rien.
   */
  it('refuse les jambes inversées au contrôle « aucune position bloquée », pas avant', () => {
    const spec = CASES.find((c) => c.id === '26-jambes-inversees');
    if (spec === undefined) throw new Error('cas 26 absent du jeu de référence');
    const reply = CASSETTES.get(keyOf(spec, MODEL));
    if (reply === undefined) throw new Error('cassette du cas 26 absente');
    const model = parseMappingReply(reply.text, spec.input as ColumnMappingInput, TYPE_TARGETS);
    // Contrôle 0 : la réponse est parfaitement conforme. C'est tout l'intérêt du cas.
    expect(model).not.toBeNull();
    expect(mappingVerifier(spec)(model!)).toMatch(/^blocked=/);
  });
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
