/**
 * Chargé dans le service worker généré (vite.config.ts → workbox.importScripts) : gère le clic
 * sur une notification d'alerte de prix. Une fenêtre de l'app déjà ouverte est focalisée telle
 * quelle (l'utilisateur garde son écran, le centre d'alertes in-app porte le détail) ; sinon
 * l'app s'ouvre sur la page Alertes (`notification.data.url`).
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client)
          return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
