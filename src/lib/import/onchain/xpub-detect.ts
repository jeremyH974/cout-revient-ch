/**
 * Reconnaissance d'une clé étendue **sans dépendance** : l'écran de saisie et l'état applicatif
 * doivent pouvoir distinguer une adresse d'une clé étendue (et surtout refuser une clé PRIVÉE)
 * sans tirer la cryptographie de `xpub.ts` dans le bundle principal — elle n'est chargée que
 * lorsqu'une dérivation a réellement lieu.
 */

/** xpub / ypub / zpub du réseau principal (base58, 111 caractères en pratique). */
export const EXTENDED_PUBLIC_RE = /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{95,120}$/;
/** xprv / yprv / zprv : reconnues uniquement pour être refusées avec un message clair. */
export const EXTENDED_PRIVATE_RE = /^[xyz]prv[1-9A-HJ-NP-Za-km-z]{95,120}$/;
