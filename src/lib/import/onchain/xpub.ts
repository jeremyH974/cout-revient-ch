/**
 * Clés publiques étendues Bitcoin (xpub/ypub/zpub) — **dérivation locale**.
 *
 * Pourquoi localement : aucune API publique sans clé n'accepte une clé étendue (mempool.space
 * répond 404, sonde du 24/08/2026), et surtout confier un xpub à un tiers lui livrerait pour
 * toujours l'intégralité du portefeuille — passé ET futur, chaque adresse de réception comme
 * chaque adresse de monnaie. Ici la clé ne quitte jamais le navigateur : seules des adresses
 * individuelles sont interrogées, exactement comme pour une adresse saisie à la main.
 *
 * Trois schémas (SLIP-132) : la version des 4 premiers octets dit l'encodage d'adresse attendu.
 * On la réécrit en `xpub` avant d'appeler BIP32 (qui n'accepte que la version standard), puis on
 * encode l'adresse selon le préfixe D'ORIGINE. Taproot (BIP86, `bc1p…`) n'est pas couvert.
 *
 * Les dépendances de cryptographie (@scure/@noble, auditées) ne sont tirées que par ce module :
 * l'appelant l'importe dynamiquement, le bundle principal n'en porte rien.
 */
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createBase58check, bech32 } from '@scure/base';
import { HDKey } from '@scure/bip32';

export type AddressScheme = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

export const SCHEME_LABELS: Record<AddressScheme, string> = {
  p2pkh: 'Legacy (BIP44, adresses en 1…)',
  'p2sh-p2wpkh': 'SegWit compatible (BIP49, adresses en 3…)',
  p2wpkh: 'SegWit natif (BIP84, adresses en bc1q…)',
};

/** Versions publiques mainnet reconnues (SLIP-132). */
const PUBLIC_VERSIONS: Record<string, AddressScheme> = {
  '0488b21e': 'p2pkh', // xpub
  '049d7cb2': 'p2sh-p2wpkh', // ypub
  '04b24746': 'p2wpkh', // zpub
};

/** Versions PRIVÉES : reconnues uniquement pour pouvoir les refuser avec un message clair. */
const PRIVATE_VERSIONS = new Set(['0488ade4', '049d7878', '04b2430c']); // xprv, yprv, zprv

const XPUB_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);

/** Base58Check lié à SHA-256 (Bitcoin) : `@scure/base` n'expose qu'une fabrique. */
const base58check = createBase58check(sha256);

export { EXTENDED_PRIVATE_RE, EXTENDED_PUBLIC_RE } from './xpub-detect';

export class XpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XpubError';
  }
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const hash160 = (bytes: Uint8Array): Uint8Array => ripemd160(sha256(bytes));

export interface ParsedExtendedKey {
  scheme: AddressScheme;
  hd: HDKey;
}

/**
 * Analyse une clé étendue publique. Lève une `XpubError` explicite sur une clé privée, une somme
 * de contrôle fausse, une version testnet ou une longueur incorrecte — jamais un échec muet.
 */
export function parseExtendedKey(text: string): ParsedExtendedKey {
  const trimmed = text.trim();
  let raw: Uint8Array;
  try {
    raw = base58check.decode(trimmed);
  } catch {
    throw new XpubError(
      'Clé étendue illisible : vérifiez qu’elle a été collée en entier, sans espace ni retour à la ligne.',
    );
  }
  if (raw.length !== 78) throw new XpubError('Clé étendue de longueur inattendue.');
  const version = hex(raw.slice(0, 4));
  if (PRIVATE_VERSIONS.has(version))
    throw new XpubError(
      'Ceci est une clé PRIVÉE étendue : elle donne accès à vos fonds. Ne la collez nulle part, ' +
        'ni ici ni ailleurs. Utilisez la clé publique étendue (xpub, ypub ou zpub).',
    );
  const scheme = PUBLIC_VERSIONS[version];
  if (scheme === undefined)
    throw new XpubError(
      'Type de clé étendue non reconnu (seuls xpub, ypub et zpub du réseau principal sont acceptés).',
    );
  const normalized = new Uint8Array(raw);
  normalized.set(XPUB_VERSION, 0);
  let hd: HDKey;
  try {
    hd = HDKey.fromExtendedKey(base58check.encode(normalized));
  } catch {
    throw new XpubError('Clé étendue invalide (dérivation impossible).');
  }
  return { scheme, hd };
}

/** Clé publique compressée → adresse, selon le schéma de la clé étendue d'origine. */
export function addressOf(publicKey: Uint8Array, scheme: AddressScheme): string {
  const keyHash = hash160(publicKey);
  if (scheme === 'p2pkh') return base58check.encode(new Uint8Array([0x00, ...keyHash]));
  if (scheme === 'p2sh-p2wpkh') {
    // Le script de rachat P2WPKH (OP_0 PUSH20 <hash>) est lui-même haché puis encodé en P2SH.
    const redeem = hash160(new Uint8Array([0x00, 0x14, ...keyHash]));
    return base58check.encode(new Uint8Array([0x05, ...redeem]));
  }
  return bech32.encode('bc', [0, ...bech32.toWords(keyHash)]);
}

/** Chaîne de dérivation : 0 = adresses de réception, 1 = adresses de monnaie (change). */
export type DerivationChain = 0 | 1;

/**
 * Dérive `count` adresses consécutives à partir de l'index `from` sur une chaîne. La dérivation
 * publique BIP32 ne peut pas produire d'index durci : `from + count` doit rester sous 2³¹.
 */
export function deriveAddresses(
  parsed: ParsedExtendedKey,
  chain: DerivationChain,
  from: number,
  count: number,
): string[] {
  const branch = parsed.hd.deriveChild(chain);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const child = branch.deriveChild(from + i);
    const publicKey = child.publicKey;
    if (publicKey === null) throw new XpubError('Dérivation impossible : clé publique absente.');
    out.push(addressOf(publicKey, parsed.scheme));
  }
  return out;
}
