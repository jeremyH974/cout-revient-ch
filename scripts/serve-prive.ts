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
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
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
 * Résout une URL en chemin de fichier **à l'intérieur** de `dist/`, ou `null`.
 *
 * La normalisation puis la vérification du préfixe sont ce qui empêche `../../` de remonter hors du
 * dossier servi. Ce serveur n'écoute que la boucle locale, mais un traversal reste un traversal :
 * une extension de navigateur ou une page malveillante ouverte dans le même navigateur peut lui
 * adresser des requêtes.
 */
function resolveInsideRoot(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  } catch {
    return null;
  }
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

function serve(request: IncomingMessage, response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const resolved = resolveInsideRoot(request.url ?? '/');
  if (resolved === null) {
    response.writeHead(400).end('Requête refusée.');
    return;
  }

  // Routeur à fragment (`#/...`) : toute URL inconnue rend `index.html`, comme sur Pages.
  const isFile = existsSync(resolved) && statSync(resolved).isFile();
  const file = isFile ? resolved : join(ROOT, 'index.html');
  if (!existsSync(file)) {
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

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('Aucun build dans dist/. Lancez d’abord :\n  npm run prive:build');
  process.exit(1);
}

createServer(serve).listen(PORT, HOST, () => {
  console.log(`Coût de revient CH — variante personnelle
  → http://${DISPLAY_HOST}:${PORT}

  Écoute sur ${HOST} uniquement : rien n'est joignable depuis le réseau.
  Origine dédiée : le stockage n'est partagé avec aucun autre projet local.
  Sortie réseau coupée au démarrage ; la Content-Security-Policy part en en-tête HTTP.`);
});
