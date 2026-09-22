/**
 * Types partagés du suivi de synchronisation (CRDT à base d'état, LWW par enregistrement).
 *
 * Sources : Shapiro et al., « A comprehensive study of Convergent and Commutative Replicated Data
 * Types », INRIA RR-7506 (2011, LWW-Register/LWW-Map) ; Kulkarni & Demirbas, « Logical Physical
 * Clocks and Consistent Snapshots in Globally Distributed Databases » (2014, horloge logique
 * hybride) ; Ink & Switch, « Cambria: Schema Evolution for Collaborative Software » (champs
 * additifs plutôt que migration cassante).
 */

/** Version d'UN enregistrement : quand, et si cette version est une suppression. */
export interface EntryVersion {
  /** Horloge logique hybride (`sync/hlc.ts`) au moment de l'écriture. Jamais `''` ici : une
   *  version enregistrée n'est par définition pas héritée — l'absence de version EST l'héritage. */
  t: string;
  /** Présent et `true` seulement pour une suppression (pierre tombale). Absent = valeur vivante. */
  del?: true;
}

/** Versions d'une collection suivie, par clé d'enregistrement. */
export type CollectionVersions = Record<string, EntryVersion>;

/**
 * Métadonnées de synchronisation d'un état complet. Persistées dans `StoredStateV1.sync`
 * (champ optionnel — absent = « tout hérité », une sauvegarde antérieure à ce chantier).
 */
export interface SyncMeta {
  v: 1;
  /** Horloge logique hybride la plus avancée jamais vue par cet appareil, fusions comprises. */
  clock: string;
  /** Par collection suivie (`sync/tracked.ts`), par clé. Une clé absente = héritée. */
  versions: Record<string, CollectionVersions>;
}

export const SYNC_META_VERSION = 1 as const;

/** État de synchronisation « vierge » : horloge héritée, aucune version connue. */
export function emptySyncMeta(): SyncMeta {
  return { v: SYNC_META_VERSION, clock: '', versions: {} };
}
