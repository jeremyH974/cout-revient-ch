/**
 * Serveur MCP local, en LECTURE SEULE, sur le portefeuille (décision n° 48).
 *
 * Transport stdio du protocole Model Context Protocol : JSON-RPC 2.0, un message par ligne, rien
 * d'autre que des messages sur `stdout`, les journaux sur `stderr` (exigences de la spécification
 * 2025-06-18). Écrit à la main, **sans aucune dépendance** : la surface utile tient en trois
 * méthodes (`initialize`, `tools/list`, `tools/call`) et le projet paie assez cher sa vigilance
 * sur la chaîne d'approvisionnement npm pour ne pas y ajouter un arbre entier — c'est le même
 * arbitrage que l'anneau SVG écrit à la main plutôt qu'une bibliothèque de graphiques.
 *
 * Usage : `node mcp/dist/server.js <chemin-de-la-sauvegarde.json>`
 * (ou variable d'environnement `CRCH_BACKUP`).
 */
import { BackupError, loadView, type McpView } from './state';
import { TOOL_DEFINITIONS, ToolError, findTool } from './tools';

/** Versions du protocole que ce serveur sait parler ; la plus récente en tête. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const SERVER_INFO = { name: 'cout-revient-ch', title: 'Coût de revient CH', version: '1.0.0' };

const INSTRUCTIONS =
  'Outils de LECTURE sur un portefeuille crypto, calculés localement à partir d’une sauvegarde de ' +
  'l’application « Coût de revient CH ». Les chiffres valent à la date de la sauvegarde et les ' +
  'cours viennent de son cache : aucune source en ligne n’est consultée. Rien de ce que rendent ' +
  'ces outils n’est un conseil en investissement ni un conseil fiscal.';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
};

function write(message: Record<string, unknown>): void {
  // Un message par ligne, jamais de retour à la ligne interne : `JSON.stringify` les échappe.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const respond = (id: string | number, result: unknown): void =>
  write({ jsonrpc: '2.0', id, result });

const fail = (id: string | number, code: number, message: string): void =>
  write({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * Négociation de version : on répond la version demandée si on sait la parler, sinon la nôtre —
 * au client de décider s'il continue (règle de la spécification).
 */
function negotiate(requested: unknown): string {
  return typeof requested === 'string' &&
    (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested)
    ? requested
    : SUPPORTED_PROTOCOLS[0];
}

/** Résultat d'un appel d'outil : contenu texte ET contenu structuré (compatibilité descendante). */
function toolResult(payload: unknown): Record<string, unknown> {
  const text = JSON.stringify(payload, null, 1);
  return { content: [{ type: 'text', text }], structuredContent: payload };
}

function toolError(message: string): Record<string, unknown> {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export interface Handlers {
  /** Recharge la vue à CHAQUE appel : la sauvegarde peut avoir été réécrite entre deux questions. */
  view: () => Promise<McpView>;
}

/** Traite un message entrant. Exporté pour être testé sans lancer de processus. */
export async function handle(message: JsonRpcRequest, handlers: Handlers): Promise<void> {
  const { method, id } = message;
  // Une notification (sans `id`) n'attend aucune réponse : « initialized », « cancelled »…
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: negotiate(message.params?.['protocolVersion']),
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
    return;
  }
  if (method === 'ping') {
    respond(id, {});
    return;
  }
  if (method === 'tools/list') {
    respond(id, { tools: TOOL_DEFINITIONS });
    return;
  }
  if (method === 'tools/call') {
    const name = message.params?.['name'];
    if (typeof name !== 'string') {
      fail(id, ERROR.invalidParams, 'Paramètre « name » manquant.');
      return;
    }
    const tool = findTool(name);
    if (!tool) {
      fail(id, ERROR.invalidParams, `Outil inconnu : ${name}`);
      return;
    }
    const args = (message.params?.['arguments'] ?? {}) as Record<string, unknown>;
    try {
      const view = await handlers.view();
      respond(id, toolResult(tool.run(view, args)));
    } catch (error) {
      // Erreur d'exécution (sauvegarde absente, argument hors bornes) : elle appartient au
      // RÉSULTAT, pas au protocole — le modèle doit pouvoir la lire et se corriger.
      const reason =
        error instanceof ToolError || error instanceof BackupError
          ? error.message
          : `Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`;
      respond(id, toolError(reason));
    }
    return;
  }
  fail(id, ERROR.methodNotFound, `Méthode non prise en charge : ${method}`);
}

/** Découpe le flux d'entrée en lignes et traite chaque message, en série. */
export function serve(input: NodeJS.ReadableStream, handlers: Handlers): void {
  let buffer = '';
  let queue: Promise<void> = Promise.resolve();
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (line === '') continue;
      let parsed: JsonRpcRequest | null = null;
      try {
        parsed = JSON.parse(line) as JsonRpcRequest;
      } catch {
        write({
          jsonrpc: '2.0',
          id: null,
          error: { code: ERROR.parse, message: 'JSON illisible.' },
        });
        continue;
      }
      // Sérialisé : les réponses sortent dans l'ordre des requêtes, et une lecture de fichier
      // lente ne peut pas entrelacer deux écritures sur `stdout`.
      queue = queue.then(() => handle(parsed, handlers)).catch(() => undefined);
    }
  });
}

/** Point d'entrée : chemin de la sauvegarde en argument ou dans `CRCH_BACKUP`. */
async function main(): Promise<void> {
  const path = process.argv[2] ?? process.env['CRCH_BACKUP'];
  if (!path) {
    process.stderr.write(
      'Chemin de la sauvegarde attendu : node mcp/dist/server.js <sauvegarde.json>\n',
    );
    process.exitCode = 1;
    return;
  }
  // Vérification au démarrage : mieux vaut échouer tout de suite que sur le premier appel d'outil.
  try {
    const view = await loadView(path);
    process.stderr.write(
      `Coût de revient CH — sauvegarde du ${view.exportedAt ?? 'date inconnue'} chargée (${view.events.length} événements).\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  serve(process.stdin, { view: () => loadView(path) });
}

// Exécuté seulement en tant que programme : les tests importent `handle` et `serve` directement.
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) void main();
