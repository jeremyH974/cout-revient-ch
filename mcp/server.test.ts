/**
 * Épreuve de bout en bout du serveur MCP : un VRAI processus `node`, une VRAIE poignée de main
 * JSON-RPC sur stdio — pas un appel de fonction en mémoire (ça, c'est déjà couvert par
 * `mcp/tools.test.ts`, qui n'importe jamais `server.ts` et ne lance aucun processus). Sans ce
 * fichier, l'affirmation de `docs/mcp.md` (« épreuve de bout en bout vérifiée ») serait fausse.
 *
 * Nécessite `mcp/dist/server.js` : voir le hook `beforeAll` ci-dessous, qui échoue avec un message
 * explicite plutôt qu'avec la trace obscure d'un `spawn` sur un fichier absent.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCoinhouseCsv } from '../src/lib/import/coinhouse/index';
import { serializeBackup } from '../src/lib/storage/json-io';
import { emptyState, type StoredStateV1 } from '../src/lib/storage/schema';
import { buildView } from './state';

const SERVER_PATH = 'mcp/dist/server.js';
const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';
const EXPORTED_AT = '2026-08-25T12:00:00.000Z';

/**
 * Même sauvegarde synthétique que `mcp/tools.test.ts` (motif `fixtureView`), mais rendue au
 * serveur comme un VRAI fichier sur disque : c'est le processus qui doit la lire par ses propres
 * moyens (`loadView`), pas un état déjà construit qu'on lui passerait en mémoire.
 */
function fixtureState(): StoredStateV1 {
  const parsed = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp:mcp');
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    ...emptyState(),
    rawRows: parsed.rows,
    priceCache: {
      btc: {
        asset: 'btc',
        priceEur: '60000',
        at: '2026-08-25T10:00:00Z',
        source: 'test',
        stale: false,
      },
      eth: {
        asset: 'eth',
        priceEur: '2000',
        at: '2026-08-25T10:00:00Z',
        source: 'test',
        stale: false,
      },
    },
  };
}

/**
 * Client JSON-RPC minimal pour le test : une ligne = un message. Le serveur sérialise son
 * traitement (`server.ts` : « une lecture de fichier lente ne peut pas entrelacer deux écritures
 * sur stdout »), donc les réponses sortent DANS L'ORDRE des requêtes — une simple file d'attente
 * suffit à les apparier, `request()` vérifie quand même l'`id` pour ne rien tenir pour acquis.
 */
class McpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdoutLines: string[] = [];
  private readonly rl: Interface;
  private readonly waiting: ((line: string) => void)[] = [];
  private readonly backlog: string[] = [];
  private stderrChunks = '';

  constructor(serverPath: string, backupPath: string) {
    this.child = spawn(process.execPath, [serverPath, backupPath]);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => (this.stderrChunks += chunk));
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => {
      if (line.trim() === '') return;
      this.stdoutLines.push(line);
      const resolve = this.waiting.shift();
      if (resolve) resolve(line);
      else this.backlog.push(line);
    });
  }

  stderrText(): string {
    return this.stderrChunks;
  }

  private nextLine(): Promise<string> {
    const queued = this.backlog.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async request(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    const line = await this.nextLine();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed['id'] !== message['id']) {
      throw new Error(`Réponse hors ordre : attendu id=${String(message['id'])}, reçu ${line}`);
    }
    return parsed;
  }

  close(): void {
    this.rl.close();
    this.child.kill();
  }
}

describe('serveur MCP — poignée de main réelle sur stdio', () => {
  let tmpDir: string;
  let backupPath: string;
  let proc: McpProcess;
  let requestId = 0;
  const nextId = () => `t${++requestId}`;

  beforeAll(() => {
    if (!existsSync(SERVER_PATH)) {
      throw new Error(
        `${SERVER_PATH} est introuvable : lancez \`npm run mcp:build\` avant de relancer les tests.`,
      );
    }
    tmpDir = mkdtempSync(join(tmpdir(), 'crch-mcp-'));
    backupPath = join(tmpDir, 'sauvegarde.json');
    writeFileSync(backupPath, serializeBackup(fixtureState(), EXPORTED_AT), 'utf8');
    proc = new McpProcess(SERVER_PATH, backupPath);
  });

  afterAll(() => {
    proc?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('répond à ping une fois la sauvegarde chargée', async () => {
    const response = await proc.request({ jsonrpc: '2.0', id: nextId(), method: 'ping' });
    expect(response['result']).toEqual({});
  });

  it('négocie la version demandée quand elle est connue', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    const result = response['result'] as Record<string, unknown>;
    expect(result['protocolVersion']).toBe('2024-11-05');
    expect((result['serverInfo'] as Record<string, unknown>)['name']).toBe('cout-revient-ch');
    expect((result['capabilities'] as Record<string, unknown>)['tools']).toEqual({
      listChanged: false,
    });
  });

  it('se replie sur sa propre version pour un protocole inconnu, comme l’exige la spécification', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'initialize',
      params: { protocolVersion: '1970-01-01' },
    });
    const result = response['result'] as Record<string, unknown>;
    expect(result['protocolVersion']).toBe('2025-06-18');
  });

  it('rend les 7 outils, tous annotés lecture-seule, à tools/list', async () => {
    const response = await proc.request({ jsonrpc: '2.0', id: nextId(), method: 'tools/list' });
    const tools = (response['result'] as Record<string, unknown>)['tools'] as Record<
      string,
      unknown
    >[];
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      const annotations = tool['annotations'] as Record<string, unknown>;
      expect(annotations['readOnlyHint'], String(tool['name'])).toBe(true);
      expect(annotations['destructiveHint'], String(tool['name'])).toBe(false);
    }
    expect(tools.map((t) => t['name'])).toContain('get_portfolio');
  });

  it('tools/call rend du contenu texte ET structuré, identiques aux totaux du moteur', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: 'get_portfolio', arguments: {} },
    });
    const result = response['result'] as Record<string, unknown>;
    const structured = result['structuredContent'] as Record<string, unknown>;
    const content = result['content'] as { type: string; text: string }[];
    expect(content[0]?.type).toBe('text');
    expect(JSON.parse(content[0]?.text ?? 'null')).toEqual(structured);

    // Même sauvegarde relue directement par le moteur (hors processus) : les totaux doivent
    // coïncider au caractère près, sinon le serveur calculerait autre chose que l'app.
    const engineView = buildView(fixtureState(), backupPath, EXPORTED_AT);
    const totals = structured['totals'] as Record<string, unknown>;
    expect(totals['realizedEur']).toBe(engineView.report.totals.realized.toString());
  });

  it('un outil inconnu produit une erreur JSON-RPC, pas un résultat d’outil', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: 'delete_everything', arguments: {} },
    });
    expect(response['result']).toBeUndefined();
    const error = response['error'] as Record<string, unknown>;
    expect(error['code']).toBe(-32602);
    expect(String(error['message'])).toContain('delete_everything');
  });

  it('une erreur d’exécution d’un outil CONNU reste un résultat (isError), pas une erreur JSON-RPC', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'tools/call',
      params: { name: 'get_position', arguments: { asset: 'inexistant' } },
    });
    expect(response['error']).toBeUndefined();
    const result = response['result'] as Record<string, unknown>;
    expect(result['isError']).toBe(true);
  });

  it('une méthode non supportée produit "method not found"', async () => {
    const response = await proc.request({
      jsonrpc: '2.0',
      id: nextId(),
      method: 'resources/list',
    });
    const error = response['error'] as Record<string, unknown>;
    expect(error['code']).toBe(-32601);
  });

  it('du début à la fin : chaque ligne de stdout est un message JSON-RPC valide, rien de plus', () => {
    // Vérifié en dernier, après plusieurs allers-retours : le bandeau de démarrage a largement eu
    // le temps d'atteindre notre lecteur de stderr, aucune synchronisation artificielle requise.
    expect(proc.stderrText()).toContain('sauvegarde du');
    expect(proc.stderrText()).not.toContain('"jsonrpc"');

    expect(proc.stdoutLines.length).toBe(requestId);
    for (const line of proc.stdoutLines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed['jsonrpc']).toBe('2.0');
    }
  });
});
