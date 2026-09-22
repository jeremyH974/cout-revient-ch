/**
 * La dérivation de clé depuis une phrase secrète, **en un seul endroit** (décision n° 151).
 *
 * Deux fichiers en avaient besoin et ne s'étaient pas rencontrés : le coffre du navigateur
 * (`vault.ts`) dérivait en **Argon2id**, la sauvegarde exportée (`encryption.ts`) en **PBKDF2**.
 * Deux forces différentes pour la même menace — un fichier ou un profil volé, attaqué hors ligne,
 * sans limite de tentatives — et la plus faible protégeait précisément ce qui voyage.
 *
 * ## Pourquoi Argon2id
 *
 * PBKDF2 n'est coûteux qu'en **temps** : une carte graphique en calcule des milliards en parallèle
 * pour presque rien. Argon2id est coûteux en **mémoire**, et c'est exactement ce qu'un attaquant ne
 * peut pas paralléliser à bon marché. C'est le premier choix de la fiche OWASP « Password Storage »
 * et de la RFC 9106.
 *
 * ## Pourquoi du JavaScript pur, et pas du WebAssembly
 *
 * Toutes les implémentations WebAssembly d'Argon2 — `hash-wasm`, `argon2-browser`, `argon2ian` —
 * exigent **`wasm-unsafe-eval` dans la CSP**. Ce n'est pas une limite de ces bibliothèques mais de
 * la plateforme : la spécification CSP le réclame pour toute compilation WebAssembly. Les ajouter
 * reviendrait donc à **affaiblir la CSP stricte de cette application pour renforcer un mot de
 * passe** — un échange qui ne se justifie pas. `@noble/hashes` est en JavaScript pur, déjà en
 * dépendance de production, activement maintenu, et ne demande aucune exception.
 *
 * Le prix est la vitesse : Argon2 en JavaScript est plus lent qu'en WebAssembly. Mesuré ici,
 * ~250 ms sous Node et ~230 ms dans Chromium — payé une fois par ouverture ou par export, jamais
 * en boucle. C'est un prix acceptable ; une CSP trouée ne l'est pas.
 *
 * ## Les paramètres voyagent en clair
 *
 * Ils sont écrits dans l'en-tête du coffre comme dans celui de la sauvegarde, jamais supposés à la
 * lecture. Les relever un jour n'invalidera donc aucun fichier existant : chacun s'ouvrira avec les
 * siens. C'est la seule façon d'être prêt pour le futur sans savoir de quoi il sera fait — et c'est
 * ce que font `age`, JWE (`p2s`/`p2c`) et les autres formats de référence.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';

/** Coût de la dérivation. Mémoire en kibioctets, itérations, parallélisme. */
export interface KdfParams {
  /** Mémoire en KiB. */
  m: number;
  /** Itérations. */
  t: number;
  /** Voies parallèles. */
  p: number;
}

/**
 * Première configuration de la fiche OWASP « Password Storage » pour Argon2id — 46 Mio, une
 * itération, une voie.
 *
 * `p: 1` n'est pas une économie : l'implémentation est en JavaScript pur, sur un seul fil.
 * Annoncer `p: 4` coûterait le même temps qu'`p: 1` **chez nous** tout en divisant par quatre le
 * travail qu'un attaquant multi-cœurs doit fournir. Réclamer un parallélisme qu'on n'exécute pas
 * revient à s'affaiblir en croyant se renforcer.
 */
export const KDF_PARAMS: KdfParams = { m: 47_104, t: 1, p: 1 };

/**
 * Bornes des paramètres Argon2id **lus dans un fichier** (sauvegarde v2, boîte aux lettres v3).
 *
 * Les paramètres voyagent en clair avec le fichier et pilotent la dérivation : sans borne, un
 * fichier corrompu — ou déposé par un tiers dans le dossier synchronisé, que le PC relit à chaque
 * ouverture — pourrait réclamer des gigaoctets de mémoire et figer l'onglet à chaque démarrage.
 *
 * Seul le **plafond** protège celui qui lit : 256 Mio, 10 itérations, 4 voies — plus de cinq fois
 * ce que l'application écrit (`KDF_PARAMS`), et encore tenable sur un téléphone. Un plancher, lui,
 * ne protégerait rien à la lecture : des paramètres faibles sont un choix de l'écrivain, et
 * l'application écrit toujours `KDF_PARAMS`. Le plancher retenu est donc celui de la spécification
 * d'Argon2 (RFC 9106 : mémoire ≥ 8 Kio par voie, au moins une itération et une voie), ce qui laisse
 * aux tests leurs paramètres volontairement minuscules.
 */
export const KDF_PARAMS_LIMITS = {
  m: { min: 8, max: 262_144 },
  t: { min: 1, max: 10 },
  p: { min: 1, max: 4 },
} as const;

/**
 * Vrai si les paramètres lus dans un fichier sont des entiers dans les bornes ci-dessus, et si la
 * mémoire couvre au moins 8 Kio par voie (RFC 9106).
 */
export function isAcceptableKdfParams(params: unknown): params is KdfParams {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  const inBounds = (['m', 't', 'p'] as const).every((k) => {
    const v = p[k];
    return (
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= KDF_PARAMS_LIMITS[k].min &&
      v <= KDF_PARAMS_LIMITS[k].max
    );
  });
  return inBounds && (p['m'] as number) >= 8 * (p['p'] as number);
}

/** 128 bits, comme la RFC 9106 le demande — et non les 32 bits minimaux du NIST. */
export const KDF_SALT_BYTES = 16;

/** AES-256. */
export const KDF_KEY_BYTES = 32;

const AES = { name: 'AES-GCM', length: 256 } as const;

/**
 * Rend la main à l'ordonnanceur toutes les 100 ms : l'interface reste vivante (un rendu par
 * dixième de seconde suffit à une barre de progression) sans payer une reprise de tâche toutes les
 * 10 ms — un tick court multiplie le coût quand l'onglet passe en arrière-plan, où les minuteurs
 * sont bridés à la seconde.
 */
const ASYNC_TICK_MS = 100;

/**
 * Dérive une clé AES-GCM **non exportable** depuis une phrase secrète.
 *
 * `extractable: false` : rien ne peut la relire hors de `crypto.subtle`, et elle ne vit qu'en
 * mémoire le temps de l'opération. Aucune récupération n'est possible si la phrase est perdue —
 * l'application ne la connaît pas, ne la transmet nulle part, et il n'existe ni compte ni service
 * capable de la réinitialiser.
 */
export async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  params: KdfParams,
  onProgress?: (fraction: number) => void,
): Promise<CryptoKey> {
  const raw = await argon2idAsync(new TextEncoder().encode(passphrase), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: KDF_KEY_BYTES,
    asyncTick: ASYNC_TICK_MS,
    ...(onProgress ? { onProgress } : {}),
  });
  const bytes = new Uint8Array(raw.length);
  bytes.set(raw);
  return crypto.subtle.importKey('raw', bytes, AES, false, ['encrypt', 'decrypt']);
}
