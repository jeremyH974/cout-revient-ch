/**
 * Texte d'un PDF, reconstitué en lignes. Trois difficultés, trois réponses.
 *
 * **1. Les glyphes ne sont pas des caractères.** Une police `Type0/Identity-H` code chaque glyphe
 * sur deux octets, dont la valeur n'a aucun rapport avec l'Unicode. Le document embarque pour cela
 * une table `ToUnicode` : c'est elle qui fait foi, et sans elle on ne devine rien — le fragment est
 * alors rendu vide plutôt qu'en charabia.
 *
 * **2. La position n'est pas l'ordre du fichier.** Un PDF pose du texte, il ne le raconte pas :
 * l'ordre des opérateurs ne dit rien des lignes. Il faut tenir la **matrice de texte** que la norme
 * décrit — `BT` la remet à l'identité, `Tm` pose une position absolue, `Td`/`TD` translatent la
 * matrice de LIGNE (et non la courante), `T*` avance d'un interligne. Translater naïvement, comme
 * une première version le faisait, fait dériver la position et disperse chaque mot sur sa propre
 * ligne — un tableau devient illisible.
 *
 * **3. Les espaces n'existent pas toujours.** Un producteur qui justifie son texte n'écrit pas
 * d'espace : il déplace le curseur d'un crénage négatif entre deux fragments. Un écart assez grand
 * EST un espace, et l'ignorer recolle les mots.
 *
 * Le regroupement en lignes se fait **par page** : deux pages à la même hauteur ne sont pas la
 * même ligne, et les confondre mélangeait le corps du contrat avec son échéancier.
 */
import { indexOfBytes, latin1, type PdfObject } from './objects';

/** Fragment posé sur la page, avant regroupement. */
interface Fragment {
  page: number;
  y: number;
  x: number;
  text: string;
}

interface Font {
  /** Code de glyphe → texte ; `null` quand le document ne fournit pas de table. */
  cmap: Map<number, string> | null;
  /** `Identity-H` code sur deux octets. */
  twoByte: boolean;
  /** La police déclare `/WinAnsiEncoding` : la plage 0x80–0x9F n'est PAS du Latin-1. */
  winAnsi: boolean;
}

/**
 * WinAnsi (cp1252) diffère de Latin-1 sur les trente-deux codes 0x80–0x9F, que Latin-1 laisse aux
 * caractères de commande. C'est là que vit le **signe euro** (0x80) — et sans cette table, un
 * montant d'un contrat WinAnsi rendait, à la place de l'euro, le caractère de commande U+0080 :
 * invisible à l'œil, mais toute expression régulière cherchant « € » échouait alors en silence.
 */
const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

const HEX_RUN = /<([0-9A-Fa-f\s]*)>/g;

/** Table `ToUnicode` : `beginbfchar` (paires) et `beginbfrange` (triplets). */
export function toUnicodeMap(stream: string): Map<number, string> {
  const map = new Map<number, string>();
  const hex = (raw: string): string => raw.replace(/\s+/g, '');
  const text = (raw: string): string => {
    const clean = hex(raw);
    let out = '';
    for (let i = 0; i + 3 < clean.length + 1; i += 4)
      out += String.fromCharCode(parseInt(clean.slice(i, i + 4).padEnd(4, '0'), 16));
    return out;
  };
  for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const runs = [...block[1]!.matchAll(HEX_RUN)].map((m) => m[1]!);
    for (let i = 0; i + 1 < runs.length; i += 2)
      map.set(parseInt(hex(runs[i]!), 16), text(runs[i + 1]!));
  }
  for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const runs = [...block[1]!.matchAll(HEX_RUN)].map((m) => m[1]!);
    for (let i = 0; i + 2 < runs.length; i += 3) {
      const low = parseInt(hex(runs[i]!), 16);
      const high = parseInt(hex(runs[i + 1]!), 16);
      const base = text(runs[i + 2]!);
      if (!base || !Number.isFinite(low) || !Number.isFinite(high)) continue;
      // Une plage démesurée trahit une table malformée : on ne déroule pas un million d'entrées.
      for (let code = low; code <= Math.min(high, low + 65535); code++)
        map.set(code, String.fromCharCode(base.charCodeAt(0) + (code - low)));
    }
  }
  return map;
}

/**
 * Correspondance « nom de ressource → police », lue dans les dictionnaires `/Font`. On passe par
 * eux plutôt que de chercher les références au hasard : `/Resources 5 0 R` ressemble à une police
 * et n'en est pas.
 */
function fontTable(objects: Map<number, PdfObject>): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const resolve = (id: number): Font => {
    const object = objects.get(id);
    const head = object ? latin1(object.head) : '';
    const reference = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(head);
    const target = reference ? objects.get(Number(reference[1])) : undefined;
    return {
      cmap: target?.stream ? toUnicodeMap(latin1(target.stream)) : null,
      twoByte: head.includes('Identity-H') || head.includes('/Type0'),
      winAnsi: head.includes('/WinAnsiEncoding'),
    };
  };
  for (const object of objects.values()) {
    const head = latin1(object.head);
    for (const dict of head.matchAll(/\/Font\s*<<([\s\S]*?)>>/g))
      for (const entry of dict[1]!.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+0\s+R/g))
        fonts.set(entry[1]!, resolve(Number(entry[2])));
  }
  return fonts;
}

const STRING = /\((?:\\[\s\S]|[^()\\])*\)|<[0-9A-Fa-f\s]*>/y;
const TOKEN = /(BT|ET|Tf|Td|TD|Tm|T\*|TJ|Tj|'|")|(-?\d*\.?\d+)|\/([^\s/<>[\]()]+)|(\[|\])|(\S)/y;

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  '(': '(',
  ')': ')',
};

/** Octets portés par un jeton de chaîne, littéral `(…)` ou hexadécimal `<…>`. */
function stringBytes(token: string): number[] {
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '');
    const even = hex.length % 2 ? `${hex}0` : hex;
    const out: number[] = [];
    for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 16));
    return out;
  }
  const body = token.slice(1, -1);
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== String.fromCharCode(92)) {
      out.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let digits = '';
      while (
        digits.length < 3 &&
        body[i + 1] !== undefined &&
        body[i + 1]! >= '0' &&
        body[i + 1]! <= '7'
      )
        digits += body[++i]!;
      out.push(parseInt(digits, 8) & 0xff);
      continue;
    }
    i++;
    const mapped = ESCAPES[next];
    if (mapped !== undefined) out.push(mapped.charCodeAt(0));
    else if (next !== '\n' && next !== '\r') out.push(next.charCodeAt(0) & 0xff);
  }
  return out;
}

function decodeString(token: string, font: Font | null): string {
  const bytes = stringBytes(token);
  const codes: number[] = [];
  if (font?.twoByte)
    for (let i = 0; i + 1 < bytes.length; i += 2) codes.push((bytes[i]! << 8) | bytes[i + 1]!);
  else codes.push(...bytes);
  if (font?.cmap) return codes.map((code) => font.cmap!.get(code) ?? '').join('');
  if (font?.winAnsi)
    return codes.map((code) => WIN_ANSI_HIGH[code] ?? String.fromCharCode(code)).join('');
  return codes.map((code) => String.fromCharCode(code)).join('');
}

/**
 * Sous ce crénage (en millièmes d'unité de texte), le producteur a voulu un espace. Un espace
 * pèse environ 250 à 500 millièmes selon la police : 150 laisse la marge à l'ajustement fin sans
 * recoller les mots.
 */
const KERNING_IS_SPACE = -150;

function fragmentsOf(page: number, content: string, fonts: Map<string, Font>): Fragment[] {
  const out: Fragment[] = [];
  const identity = (): number[] => [1, 0, 0, 1, 0, 0];
  const translate = (m: number[], tx: number, ty: number): number[] => [
    m[0]!,
    m[1]!,
    m[2]!,
    m[3]!,
    m[0]! * tx + m[2]! * ty + m[4]!,
    m[1]! * tx + m[3]! * ty + m[5]!,
  ];
  let line = identity();
  let leading = 0;
  let font: Font | null = null;
  let operands: { kind: 'n' | 's' | 'f'; value: number | string }[] = [];
  const numbers = (): number[] =>
    operands.filter((o) => o.kind === 'n').map((o) => o.value as number);

  let at = 0;
  while (at < content.length) {
    STRING.lastIndex = at;
    const string = STRING.exec(content);
    if (string) {
      operands.push({ kind: 's', value: decodeString(string[0], font) });
      at = STRING.lastIndex;
      continue;
    }
    TOKEN.lastIndex = at;
    const token = TOKEN.exec(content);
    if (!token) {
      at++;
      continue;
    }
    at = TOKEN.lastIndex;
    const [, operator, number, name] = token;
    if (number !== undefined) {
      const value = Number(number);
      if (Number.isFinite(value)) operands.push({ kind: 'n', value });
      continue;
    }
    if (name !== undefined) {
      operands.push({ kind: 'f', value: name });
      continue;
    }
    if (operator === undefined) continue;
    switch (operator) {
      case 'BT':
        line = identity();
        break;
      case 'Tf': {
        const names = operands.filter((o) => o.kind === 'f');
        font = fonts.get(String(names[names.length - 1]?.value ?? '')) ?? null;
        break;
      }
      case 'Td':
      case 'TD': {
        const n = numbers();
        if (n.length >= 2) {
          if (operator === 'TD') leading = -n[n.length - 1]!;
          line = translate(line, n[n.length - 2]!, n[n.length - 1]!);
        }
        break;
      }
      case 'Tm': {
        const n = numbers();
        if (n.length >= 6) line = n.slice(-6);
        break;
      }
      case 'T*':
        line = translate(line, 0, -leading);
        break;
      case 'Tj':
      case 'TJ':
      case "'":
      case '"': {
        if (operator === "'" || operator === '"') line = translate(line, 0, -leading);
        let text = '';
        for (const operand of operands) {
          if (operand.kind === 's') text += operand.value as string;
          else if (operand.kind === 'n' && (operand.value as number) < KERNING_IS_SPACE)
            text += ' ';
        }
        if (text.trim()) out.push({ page, y: line[5]!, x: line[4]!, text });
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  return out;
}

const SHOWS_TEXT = new TextEncoder().encode('Tj');
const SHOWS_ARRAY = new TextEncoder().encode('TJ');

/** Deux fragments dont les hauteurs diffèrent de moins de cela appartiennent à la même ligne. */
const SAME_LINE = 2;

/** Lignes de texte du document, dans l'ordre de lecture, page par page. */
export function pdfRows(objects: Map<number, PdfObject>): string[] {
  const fonts = fontTable(objects);
  const fragments: Fragment[] = [];
  for (const [id, object] of objects) {
    const stream = object.stream;
    if (!stream) continue;
    const head = latin1(object.head);
    if (head.includes('/Font') || head.includes('ToUnicode')) continue;
    if (indexOfBytes(stream, SHOWS_TEXT) < 0 && indexOfBytes(stream, SHOWS_ARRAY) < 0) continue;
    fragments.push(...fragmentsOf(id, latin1(stream), fonts));
  }
  fragments.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const rows: string[] = [];
  let current: string[] = [];
  let key: string | null = null;
  for (const fragment of fragments) {
    const at = `${fragment.page}:${Math.round(fragment.y / SAME_LINE)}`;
    if (key !== null && at !== key) {
      rows.push(current.join(' '));
      current = [];
    }
    current.push(fragment.text);
    key = at;
  }
  if (current.length > 0) rows.push(current.join(' '));
  return rows;
}
