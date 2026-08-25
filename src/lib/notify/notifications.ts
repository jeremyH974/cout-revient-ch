/**
 * Notifications système des alertes de prix (décision n° 36) : opt-in explicite, jamais
 * demandées au chargement — la permission ne se demande que depuis un clic (les navigateurs
 * bloquent le reste, et un refus au prompt natif est quasi définitif). L'affichage passe par le
 * service worker quand il existe (`showNotification`) : c'est la seule voie sur Android et sur
 * iOS installé ; le constructeur `new Notification()` reste le secours des contextes sans SW
 * (dev). Tout est local : aucun serveur, donc aucune notification app fermée — c'est documenté,
 * pas contourné.
 */

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** À appeler UNIQUEMENT depuis un geste utilisateur (bouton « Activer »). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return notifyPermission();
  }
}

export interface SystemNotificationInput {
  title: string;
  body: string;
  /** Une notification par règle : un re-déclenchement remplace la précédente au lieu d'empiler. */
  tag: string;
}

/** URL absolue de la page Alertes (cible du clic sur une notification, via le service worker). */
function alertsUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}#/invest/alerts`, window.location.origin).toString();
}

/**
 * Affiche une notification système si la permission est accordée ; renvoie `false` sinon (le
 * centre in-app reste le canal garanti). Ne demande jamais la permission.
 */
export async function showSystemNotification(input: SystemNotificationInput): Promise<boolean> {
  if (notifyPermission() !== 'granted') return false;
  const options: NotificationOptions & { data: { url: string } } = {
    body: input.body,
    tag: input.tag,
    icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
    data: { url: alertsUrl() },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(input.title, options);
      return true;
    }
  } catch {
    // SW indisponible : tenter le constructeur ci-dessous.
  }
  try {
    // Contexte sans service worker (dev) : le constructeur lève un TypeError sur mobile.
    const notification = new Notification(input.title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
