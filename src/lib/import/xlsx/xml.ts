/**
 * Scanner XML minimal, taillé pour les documents **machine-générés** d'un classeur `.xlsx` :
 * pas de DTD, pas de CDATA, aucune imbrication d'un élément dans un élément de même nom.
 *
 * Pourquoi pas `DOMParser` : les tests tournent sous `environment: 'node'` (`vite.config.ts`) et
 * le dépôt n'embarque ni jsdom ni happy-dom. Un lecteur de classeur non testable serait pire que
 * quatre-vingts lignes lisibles — le moteur du projet ne connaît pas d'exception à la règle du
 * code testé.
 *
 * **Le préfixe d'espace de noms est ignoré**, et ce n'est pas une commodité : le relevé eToro
 * écrit `<x:sheet>`, `<x:row>`, `<x:c>` là où Excel écrit `<sheet>`. Un scanner qui chercherait
 * `<sheet` littéralement ne trouverait rien du tout, sans erreur — juste un classeur vide.
 */

export interface XmlElement {
  attrs: Record<string, string>;
  /** Contenu brut entre balise ouvrante et fermante ; chaîne vide si l'élément est auto-fermant. */
  inner: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Décode les entités XML, y compris les références numériques (`&#10;`, `&#x1F;`). */
export function decodeXmlText(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (!body.startsWith('#')) return ENTITIES[body] ?? whole;
    const code = body.startsWith('#x') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : whole;
  });
}

/** Attributs d'une balise ouvrante, valeurs décodées. Les guillemets simples sont acceptés. */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    attrs[m[1]!] = decodeXmlText(m[2]!.slice(1, -1));
  }
  return attrs;
}

/**
 * Toutes les occurrences de `<name …>` dans l'ordre du document, quel que soit le préfixe d'espace
 * de noms. `name` doit être un nom d'élément simple : il entre dans une expression régulière.
 */
export function elements(xml: string, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const open = new RegExp('<(?:([^<>:/ ]+):)?' + name + '(?=[ \t\r\n/>])', 'g');
  for (let m = open.exec(xml); m !== null; m = open.exec(xml)) {
    const end = xml.indexOf('>', m.index);
    if (end === -1) break;
    const selfClosing = xml[end - 1] === '/';
    const attrs = parseAttrs(xml.slice(m.index + m[0].length, selfClosing ? end - 1 : end));
    if (selfClosing) {
      found.push({ attrs, inner: '' });
      open.lastIndex = end;
      continue;
    }
    const stop = xml.indexOf(`</${m[1] ? `${m[1]}:` : ''}${name}>`, end);
    if (stop === -1) break;
    found.push({ attrs, inner: xml.slice(end + 1, stop) });
    open.lastIndex = stop;
  }
  return found;
}

/** Texte concaténé de tous les `<t>` d'un fragment, entités décodées (cas des `<si><r><t>`). */
export function joinText(inner: string): string {
  return elements(inner, 't')
    .map((el) => decodeXmlText(el.inner))
    .join('');
}
