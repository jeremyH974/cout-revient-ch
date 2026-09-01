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
 * Usage : `node mcp/dist/server.js [chemin-de-la-sauvegarde.json]` — l'argument est optionnel.
 * Sans lui, le serveur cherche dans l'ordre : la variable d'environnement `CRCH_BACKUP`, puis
 * l'emplacement où l'app dépose sa sauvegarde par défaut (dossier *Téléchargements*, nom de
 * fichier fixe). C'est ce dernier niveau qui rend `claude mcp add … -- node server.js` installable
 * sans qu'un chemin soit tapé dans le cas courant.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_FILE_NAME } from '../src/lib/storage/backup-folder';
import { BackupError, loadView, type McpView } from './state';
import { TOOL_DEFINITIONS, ToolError, findTool } from './tools';

/**
 * Versions du protocole que ce serveur sait parler ; la plus récente en tête (décision n° 92).
 *
 * La révision `2026-07-28` **supprime** la poignée de main `initialize` — elle ne la déprécie pas.
 * La version voyage désormais dans `_meta` à CHAQUE requête, et `server/discover` remplace la
 * découverte. Deux régimes coexistent donc dans ce même processus, distingués à la forme de la
 * requête entrante : c'est le chemin de migration que la spécification recommande elle-même, et il
 * ne casse aucun client existant.
 */
const MODERN_PROTOCOL = '2026-07-28';
/**
 * Les révisions à poignée de main, la plus récente en tête. Elles sont tenues à part parce que le
 * repli d'`initialize` doit rester DANS ce régime : répondre `2026-07-28` à un client qui vient
 * d'appeler `initialize` serait lui annoncer une révision où cette méthode n'existe pas.
 */
const LEGACY_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const SUPPORTED_PROTOCOLS = [MODERN_PROTOCOL, ...LEGACY_PROTOCOLS] as const;

/** Clés `_meta` normalisées par la révision moderne. */
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/**
 * `CacheableResult` de la révision moderne : les deux champs sont **obligatoires**.
 *
 * `private` bien que la liste d'outils ne porte aucune donnée personnelle : ce serveur n'existe
 * qu'attaché à la sauvegarde d'une personne, et sur un canal stdio mono-utilisateur le choix
 * conservateur ne coûte rien. Une heure : les outils sont compilés dans le binaire, ils ne
 * changent pas en cours d'exécution.
 */
const CACHEABLE = { ttlMs: 3_600_000, cacheScope: 'private' } as const;
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
  /** `UnsupportedProtocolVersionError` de la révision `2026-07-28`. */
  unsupportedProtocolVersion: -32022,
};

function write(message: Record<string, unknown>): void {
  // Un message par ligne, jamais de retour à la ligne interne : `JSON.stringify` les échappe.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Répond, en ajoutant `resultType` quand le client parle la révision moderne — elle l'exige sur
 * TOUT résultat. Un client ancien qui recevrait ce champ l'ignorerait, mais l'ajouter partout
 * changerait la forme du fil pour des clients qui ne l'ont pas demandé.
 */
const respond = (id: string | number, result: unknown, modern = false): void =>
  write({
    jsonrpc: '2.0',
    id,
    result: modern ? { resultType: 'complete', ...(result as object) } : result,
  });

const fail = (id: string | number, code: number, message: string): void =>
  write({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * La version que le client déclare dans `_meta`, ou `undefined` s'il n'en déclare aucune.
 *
 * C'est LE discriminant des deux régimes : la révision moderne rend ce champ obligatoire sur
 * chaque requête, l'ancienne ne le connaît pas. Pas besoin d'état de session pour les distinguer —
 * ce qui tombe bien, ce serveur n'en a jamais eu.
 */
function declaredVersion(message: JsonRpcRequest): string | undefined {
  const meta = message.params?.['_meta'];
  if (typeof meta !== 'object' || meta === null) return undefined;
  const value = (meta as Record<string, unknown>)[META_VERSION];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Négociation de version, régime ANCIEN : on répond la version demandée si on sait la parler,
 * sinon la nôtre — au client de décider s'il continue (règle de la spécification). Le régime
 * moderne, lui, ne négocie pas : il refuse explicitement (`-32022`) et laisse le client réessayer.
 */
function negotiate(requested: unknown): string {
  return typeof requested === 'string' &&
    (LEGACY_PROTOCOLS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_PROTOCOLS[0];
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

  const declared = declaredVersion(message);
  const modern = declared !== undefined;
  if (modern && !(SUPPORTED_PROTOCOLS as readonly string[]).includes(declared)) {
    // Le régime moderne ne se replie pas en silence : il nomme ce qu'il sait parler, et c'est au
    // client de rappeler avec une version commune.
    write({
      jsonrpc: '2.0',
      id,
      error: {
        code: ERROR.unsupportedProtocolVersion,
        message: 'Unsupported protocol version',
        data: { supported: [...SUPPORTED_PROTOCOLS], requested: declared },
      },
    });
    return;
  }

  /**
   * Répondu dans LES DEUX régimes, et c'est délibéré : sur stdio il n'y a pas de code de statut
   * HTTP pour guider un repli, si bien qu'un client capable des deux « SHOULD send `server/discover`
   * first » pour savoir à qui il parle. Refuser de répondre à la sonde à un client ancien la
   * rendrait inutile.
   */
  if (method === 'server/discover') {
    respond(
      id,
      {
        supportedVersions: [...SUPPORTED_PROTOCOLS],
        capabilities: { tools: { listChanged: false } },
        instructions: INSTRUCTIONS,
        ...CACHEABLE,
        _meta: { [META_SERVER_INFO]: SERVER_INFO },
      },
      true,
    );
    return;
  }

  // `initialize` et `ping` n'existent PLUS dans la révision moderne. Un client qui déclare cette
  // version et les appelle se trompe : le dire vaut mieux que de répondre à une méthode disparue.
  if (modern && (method === 'initialize' || method === 'ping')) {
    fail(
      id,
      ERROR.methodNotFound,
      `« ${method} » n'existe pas dans la révision ${MODERN_PROTOCOL} ; utilisez « server/discover ».`,
    );
    return;
  }

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
    respond(id, { tools: TOOL_DEFINITIONS, ...(modern ? CACHEABLE : {}) }, modern);
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
      respond(id, toolResult(tool.run(view, args)), modern);
    } catch (error) {
      // Erreur d'exécution (sauvegarde absente, argument hors bornes) : elle appartient au
      // RÉSULTAT, pas au protocole — le modèle doit pouvoir la lire et se corriger.
      const reason =
        error instanceof ToolError || error instanceof BackupError
          ? error.message
          : `Erreur inattendue : ${error instanceof Error ? error.message : String(error)}`;
      respond(id, toolError(reason), modern);
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

/** `undefined` pour une valeur absente OU vide : un `CRCH_BACKUP=""` oublié ne doit pas gagner. */
const nonEmpty = (value: string | undefined): string | undefined =>
  value && value.trim() !== '' ? value : undefined;

/** Dernier recours : c'est là que le navigateur dépose les téléchargements, sur chaque OS. */
function defaultBackupPath(): string {
  return join(homedir(), 'Downloads', BACKUP_FILE_NAME);
}

/**
 * Chemin de la sauvegarde, du plus explicite au plus deviné : variable d'environnement, argument
 * de ligne de commande, puis l'emplacement par défaut. Ne vérifie pas l'existence du fichier —
 * `loadView` s'en charge et produit le message d'erreur.
 */
function resolveBackupPath(argv: readonly string[]): string {
  return nonEmpty(process.env['CRCH_BACKUP']) ?? nonEmpty(argv[2]) ?? defaultBackupPath();
}

/** Point d'entrée : voir `resolveBackupPath` pour l'ordre de recherche. */
async function main(): Promise<void> {
  const path = resolveBackupPath(process.argv);
  // Vérification au démarrage : mieux vaut échouer tout de suite que sur le premier appel d'outil.
  try {
    const view = await loadView(path);
    process.stderr.write(
      `Coût de revient CH — sauvegarde du ${view.exportedAt ?? 'date inconnue'} chargée (${view.events.length} événements).\n`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Le chemin essayé et le rappel de la source : que la sauvegarde ait été devinée ou fournie,
    // c'est le SEUL diagnostic dont dispose quelqu'un qui vient de coller une commande.
    process.stderr.write(
      `${reason}\n` +
        `Chemin essayé : ${path}\n` +
        `Une sauvegarde s’obtient depuis l’app : Réglages → Télécharger une sauvegarde.\n`,
    );
    process.exitCode = 1;
    return;
  }
  serve(process.stdin, { view: () => loadView(path) });
}

// Exécuté seulement en tant que programme : les tests importent `handle` et `serve` directement.
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) void main();
