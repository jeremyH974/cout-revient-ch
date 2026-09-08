/**
 * Sert la variante personnelle, en local, avec de vrais en-têtes de sécurité.
 *
 * ## Pourquoi pas `vite preview`
 *
 * Parce que sa documentation le dit : « Do not use this as a production server as it's not designed
 * for it. » Ce n'est pas une question de charge — personne ne va marteler ce serveur — mais de ce
 * qu'il **n'envoie pas** : aucun en-tête de sécurité, et un hôte d'écoute qu'on ne contrôle pas
 * finement.
 *
 * ## Ce que ce serveur apporte, et que le site public ne peut pas avoir
 *
 * GitHub Pages ne permet aucun en-tête HTTP : la Content-Security-Policy du site publié vit dans
 * une balise `<meta>`, ce qui coûte trois directives qu'une balise ne peut pas porter —
 * `frame-ancestors`, `sandbox` et `report-uri`. Ici, on sert nous-mêmes : la CSP part en **en-tête**,
 * `frame-ancestors 'none'` comprise. Aucune page ne peut donc encadrer cette application, ce qui
 * ferme le détournement de clic là où le site public ne peut que l'espérer.
 *
 * La politique elle-même n'est pas réécrite : elle vient de `src/lib/support/csp.ts`, la même table
 * que celle qu'un test croise avec les origines réellement écrites dans le code. Un serveur avec sa
 * propre liste aurait divergé au premier ajout.
 *
 * ## Écoute
 *
 * Sur `127.0.0.1` uniquement — jamais `0.0.0.0`. La différence est concrète : sur un réseau Wi-Fi
 * partagé, un serveur qui écoute sur toutes les interfaces expose le patrimoine à quiconque est sur
 * le même réseau. Le nom `crch.localhost` est résolu en boucle locale par le navigateur lui-même
 * (RFC 6761) et n'a besoin d'aucune entrée dans le fichier `hosts`.
 */
import { createReadStream, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCsp } from '../src/lib/support/csp.ts';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const HOST = '127.0.0.1';
const PORT = Number(process.env['PORT']) || 7331;
const DISPLAY_HOST = process.env['CRCH_HOST'] ?? 'crch.localhost';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * `frame-ancestors 'none'` s'ajoute à la politique commune : c'est précisément la directive qu'une
 * balise `<meta>` ignore, donc la seule chose que ce serveur apporte à la politique elle-même.
 */
const CSP = `${buildCsp()}; frame-ancestors 'none'`;

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Aucune de ces capacités n'est utilisée ; les refuser évite qu'un jour elles le soient par accident.
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
  /*
   * Rien n'est mis en cache. Une variante personnelle change à chaque `prive:build`, et un fichier
   * périmé servi depuis le cache du navigateur donnerait une application incohérente avec ses
   * données — le genre d'incident qu'on met une heure à comprendre.
   */
  'Cache-Control': 'no-store',
};

/**
 * Ce que le serveur accepte de rendre : une table `chemin d'URL → fichier`, construite **une fois**
 * au démarrage en parcourant `dist/`.
 *
 * ## Pourquoi une liste blanche plutôt qu'une vérification de chemin
 *
 * La première version assemblait le chemin depuis l'URL, puis vérifiait que le résultat restait
 * sous `dist/`. Le contrôle était correct — mais l'analyse statique du dépôt (CodeQL,
 * `js/path-injection`) l'a signalé en sévérité haute, et elle avait raison de le faire : une
 * vérification de confinement est un raisonnement, et un raisonnement se casse à la première
 * retouche distraite. On en a vu quatre variantes s'écrire de travers dans l'écosystème.
 *
 * Ici, **aucune chaîne fournie par le client n'atteint le système de fichiers**. L'URL ne sert que
 * de clé de recherche ; le chemin rendu provient exclusivement des valeurs de la table, écrites par
 * ce fichier. Il n'y a plus rien à confiner, donc plus rien à casser — et `../../` ne désigne
 * simplement aucune clé.
 *
 * Conséquence assumée : la table est figée au démarrage. Après un `npm run prive:build`, il faut
 * relancer le serveur — ce que la séquence documentée fait de toute façon.
 */
const FILES = new Map<string, string>();

function indexDist(dir: string, prefix: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    const urlPath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) indexDist(absolute, urlPath);
    else if (entry.isFile()) FILES.set(urlPath, absolute);
  }
}

function serve(request: IncomingMessage, response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let key: string;
  try {
    key = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  } catch {
    response.writeHead(400).end('Requête refusée.');
    return;
  }

  // Routeur à fragment (`#/...`) : toute URL inconnue rend `index.html`, comme sur Pages.
  const file = FILES.get(key) ?? FILES.get('/index.html');
  if (file === undefined) {
    response.writeHead(404).end('Rien ici. Avez-vous lancé « npm run prive:build » ?');
    return;
  }

  response.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

try {
  indexDist(ROOT, '');
} catch {
  /* dossier absent : le message ci-dessous dit la même chose, une seule fois */
}
if (!FILES.has('/index.html')) {
  console.error(`Aucun build dans dist/. Lancez d’abord :
  npm run prive:build`);
  process.exit(1);
}

createServer(serve).listen(PORT, HOST, () => {
  console.log(`Coût de revient CH — variante personnelle
  → http://${DISPLAY_HOST}:${PORT}

  Écoute sur ${HOST} uniquement : rien n'est joignable depuis le réseau.
  Origine dédiée : le stockage n'est partagé avec aucun autre projet local.
  Sortie réseau coupée au démarrage ; la Content-Security-Policy part en en-tête HTTP.`);
});
