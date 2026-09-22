/**
 * La phrase de synchronisation de la boîte aux lettres (P125) : en mémoire de session SEULEMENT,
 * jamais enregistrée — même choix que la clé du coffre (`vault-session.ts`) et le même sens :
 * perdue au rechargement de l'onglet, elle protège les dépôts d'un profil de navigateur copié ou
 * d'un dossier synchronisé partagé par erreur.
 *
 * Module SÉPARÉ d'`AppState` plutôt qu'un champ de plus : la synchronisation automatique
 * (démarrage, retour au premier plan, anti-rebond après modification, `src/state/app.svelte.ts`)
 * doit pouvoir relire cette phrase sans dépendre du montage de l'écran « Synchronisation », qui
 * l'a demandée une fois. Un simple module-singleton suffit — pas de coffre, pas de dérivation ici :
 * `mailbox-envelope.ts` s'en charge à chaque chiffrement/déchiffrement.
 */
let passphrase: string | null = null;

/** La phrase saisie cette session, ou `null` si elle ne l'a pas encore été. */
export function mailboxPassphrase(): string | null {
  return passphrase;
}

/** `null` efface la phrase de la mémoire (jamais utile en pratique : rien ne la « verrouille »). */
export function setMailboxPassphrase(next: string | null): void {
  passphrase = next;
}

/** Tests : remet le module dans l'état d'un premier chargement. */
export function resetMailboxSessionForTests(): void {
  passphrase = null;
}
