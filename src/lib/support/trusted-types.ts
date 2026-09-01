/**
 * La politique Trusted Types de l'unique URL de script que l'application charge : celle de son
 * service worker.
 *
 * **Pourquoi elle existe.** `navigator.serviceWorker.register()` est un puits `TrustedScriptURL`.
 * Sous `require-trusted-types-for 'script'` (décision n° 75), lui passer une chaîne est refusé — et
 * comme `registerSW` de `vite-plugin-pwa` **avale** l'erreur pour la donner à `onRegisterError`,
 * l'échec est silencieux : l'application se rend normalement, mais elle n'a plus de service worker,
 * donc plus de hors-ligne, plus d'installation, plus de mise à jour. Constaté dans un vrai
 * navigateur le 01/09/2026 ; aucun test qui se contentait d'écouter les exceptions ne pouvait le
 * voir.
 *
 * **Pourquoi elle épingle.** La politique pourrait rendre l'URL telle quelle — ce serait suffisant
 * pour débloquer. Elle refuse au contraire tout ce qui n'est pas l'URL attendue : avant Trusted
 * Types, une injection pouvait enregistrer n'importe quel worker de même origine, et le service
 * worker est le pire endroit où en héberger un — il survit à la fermeture de l'onglet et intercepte
 * toutes les requêtes. La directive rend donc ce point **plus sûr qu'avant**, au lieu de simplement
 * ne rien casser.
 *
 * **Pourquoi un habillage de l'API.** `registerSW` construit l'URL lui-même et appelle `register`
 * sans qu'on puisse lui passer un `TrustedScriptURL`. Envelopper la méthode est le point
 * d'application le plus petit ; la réécrire reviendrait à reprendre tout le flux de mise à jour.
 */

/** Nom de la politique, croisé avec la CSP par `csp.ts` et par `csp-build.spec.ts`. */
export const SERVICE_WORKER_POLICY = 'crch-service-worker-url';

/** Le strict nécessaire de l'API Trusted Types : `lib.dom` ne la décrit pas partout. */
interface PolicyFactory {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): { createScriptURL: (input: string) => string };
}

/**
 * Installe la politique et fait passer l'enregistrement du service worker par elle.
 *
 * Sans support de Trusted Types, ou sans service worker, la fonction ne fait rien : la directive
 * est ignorée par ces navigateurs, il n'y a donc rien à débloquer.
 *
 * @param swUrl URL exacte du service worker, seule valeur que la politique acceptera.
 */
export function installServiceWorkerUrlPolicy(swUrl: string): void {
  const factory = (globalThis as { trustedTypes?: PolicyFactory }).trustedTypes;
  if (!factory || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const policy = factory.createPolicy(SERVICE_WORKER_POLICY, {
    createScriptURL: (url) => {
      if (url !== swUrl)
        throw new TypeError(
          `Enregistrement de service worker refusé : « ${url} » n’est pas « ${swUrl} ».`,
        );
      return url;
    },
  });

  const container = navigator.serviceWorker;
  const register = container.register.bind(container);
  container.register = ((url: string | URL, options?: RegistrationOptions) =>
    register(
      policy.createScriptURL(String(url)) as unknown as string,
      options,
    )) as typeof container.register;
}
