/**
 * La clé d'API Anthropic de l'utilisateur, et les consentements déjà donnés — **en mémoire vive,
 * et nulle part ailleurs**. Rechargez l'onglet : tout est perdu, et c'est le comportement voulu.
 *
 * ## Pourquoi cette clé-là ne rejoint pas les deux autres
 *
 * L'application accepte déjà deux clés facultatives qu'elle enregistre : la clé CoinGecko « Demo »
 * et la clé d'explorateur de blocs (décision n° 32). Elles ont un point commun : elles sont
 * **gratuites** et **en lecture seule** — au pire, quelqu'un lit des cours ou des transactions
 * publiques à votre place. Une clé Anthropic n'a rien à voir : c'est un **moyen de paiement**. Qui
 * l'obtient dépense l'argent de son propriétaire, sans plafond que celui de son compte.
 *
 * Le raisonnement s'arrête là : on ne compare pas la commodité au risque, on compare le risque au
 * confort perdu. Ici le confort perdu, c'est **un collage par session**. C'est peu cher payé pour
 * qu'aucune sauvegarde, aucun stockage de navigateur, aucune extension lisant les données du site
 * ne puisse jamais contenir de quoi facturer quelqu'un.
 *
 * ## L'exclusion de la sauvegarde est structurelle, pas déclarative
 *
 * La clé ne vit pas dans `StoredStateV1` : elle ne peut donc pas être sérialisée par
 * `serializeBackup`, quelle que soit la distraction du prochain relecteur. Un test le prouve sur
 * le TEXTE d'une sauvegarde issue d'un état complet, avec une sentinelle posée ici — pas sur la
 * forme du type, ce qui serait tautologique (« le champ n'existe pas » se vérifie en le lisant).
 * Un autre test lit le TEXTE de ce fichier et exige qu'aucun des noms d'API de stockage du
 * navigateur n'y apparaisse — les trois sont énumérés dans le test, pas ici : les citer dans ce
 * commentaire le ferait échouer sur sa propre documentation, comme le lexique du second avis
 * s'était pris lui-même en défaut (décision n° 67).
 *
 * ## Le consentement se mémorise par CHARGE UTILE, jamais par fonctionnalité
 *
 * On ne retient jamais « l'IA est autorisée ». On retient « **cet envoi-là** est autorisé », sous
 * l'empreinte exacte de la requête (`cassetteKey`, la même que celle qui indexe les cassettes du
 * banc d'essai). Un ré-import, un rafraîchissement de prix, un changement de devise : le JSON
 * change, l'empreinte change, le consentement est redemandé. C'est la seule mémorisation qui ne
 * puisse pas, avec le temps, autoriser l'envoi de données que l'utilisateur n'a jamais vues.
 */
import { SvelteSet } from 'svelte/reactivity';
import { cassetteKey } from '$lib/ai/adapters/recorded';
import type { ModelRequest } from '$lib/ai/contract';

function createAiKey() {
  let key = $state<string | null>(null);
  /** Empreintes des requêtes déjà consenties, pour cette session et cette session seulement. */
  const consented = new SvelteSet<string>();

  return {
    /** Vrai si une clé est en mémoire. L'écran ne pose jamais la question autrement. */
    get present(): boolean {
      return key !== null;
    },

    /**
     * La clé elle-même, pour la seule construction de l'adaptateur. Aucun écran ne l'affiche :
     * `hint` existe pour ça.
     */
    get value(): string | null {
      return key;
    },

    /** De quoi reconnaître la clé collée sans jamais la montrer : « …a1b2 ». */
    get hint(): string | null {
      return key === null ? null : `…${key.slice(-4)}`;
    },

    /** Colle une clé. Une chaîne vide efface, plutôt que d'enregistrer un jeton vide. */
    set(raw: string): void {
      const trimmed = raw.trim();
      key = trimmed === '' ? null : trimmed;
    },

    /** Oublie la clé ET les consentements : un utilisateur qui retire sa clé retire tout. */
    clear(): void {
      key = null;
      consented.clear();
    },

    /** L'empreinte d'une requête : le grain exact auquel le consentement est mémorisé. */
    fingerprint(request: ModelRequest, modelId: string): string {
      return cassetteKey(request, modelId);
    },

    /** Cet envoi précis a-t-il déjà été confirmé pendant cette session ? */
    hasConsent(request: ModelRequest, modelId: string): boolean {
      return consented.has(cassetteKey(request, modelId));
    },

    /** Enregistre le consentement de CET envoi. Jamais celui de la fonctionnalité. */
    grantConsent(request: ModelRequest, modelId: string): void {
      consented.add(cassetteKey(request, modelId));
    },

    /** Nombre de consentements en mémoire : lisible par les tests, affiché nulle part. */
    get consentCount(): number {
      return consented.size;
    },
  };
}

export const aiKey = createAiKey();
