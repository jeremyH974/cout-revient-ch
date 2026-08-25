/**
 * Noyau PUR de la vérification d'alertes en arrière-plan (Periodic Background Sync, décision
 * n° 38). Chargé dans le service worker par importScripts, et dans les tests unitaires via
 * node:vm — aucune API navigateur ici, uniquement des fonctions sur des chaînes décimales.
 *
 * Le service worker ne recalcule JAMAIS le moteur : l'app précalcule les seuils (chaînes
 * décimales EUR, `alertThresholdEur`) dans un instantané ; ici on ne fait que comparer, en
 * décimal EXACT (jamais de flottant sur un montant — même règle que src/lib/domain), et
 * appliquer la sémantique de franchissement armé/désarmé. Pas de ré-armement côté service
 * worker : c'est le choix conservateur (jamais de faux déclenchement), l'app ré-arme à
 * l'ouverture. La propriété « même verdict que le moteur » est testée dans
 * src/lib/notify/sw-core.test.ts.
 */
(function (root) {
  'use strict';

  var DECIMAL = /^-?\d+(\.\d+)?$/;

  /** Décompose une chaîne décimale : signe, partie entière et fraction normalisées. */
  function norm(text) {
    var sign = 1;
    var body = text;
    if (body.charAt(0) === '-') {
      sign = -1;
      body = body.slice(1);
    }
    var dot = body.indexOf('.');
    var int = dot === -1 ? body : body.slice(0, dot);
    var frac = dot === -1 ? '' : body.slice(dot + 1);
    int = int.replace(/^0+(?=\d)/, '');
    frac = frac.replace(/0+$/, '');
    if (int === '0' && frac === '') sign = 1; // -0 == 0
    return { sign: sign, int: int, frac: frac };
  }

  /** Compare deux valeurs absolues normalisées : longueur d'entier, puis lexicographique. */
  function cmpAbs(a, b) {
    if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
    if (a.int !== b.int) return a.int < b.int ? -1 : 1;
    var width = Math.max(a.frac.length, b.frac.length);
    var fa = a.frac;
    var fb = b.frac;
    while (fa.length < width) fa += '0';
    while (fb.length < width) fb += '0';
    if (fa === fb) return 0;
    return fa < fb ? -1 : 1;
  }

  /** Comparaison exacte de deux chaînes décimales : −1, 0 ou 1 (jamais de parseFloat). */
  function cmpDec(a, b) {
    var na = norm(a);
    var nb = norm(b);
    if (na.sign !== nb.sign) return na.sign < nb.sign ? -1 : 1;
    var m = cmpAbs(na, nb);
    if (m === 0) return 0; // jamais −0 (deux négatifs égaux)
    return na.sign < 0 ? -m : m;
  }

  /**
   * Applique les règles ARMÉES de l'instantané aux prix EUR reçus (par identifiant CoinGecko).
   * Renvoie les déclenchements et les règles mises à jour (désarmées, horodatées) ; une règle
   * sans prix, non armée ou sous le délai minimal reste inchangée. Pur et sans effet.
   */
  function decideFires(snapshot, pricesById, nowMs) {
    var fires = [];
    var rules = [];
    for (var i = 0; i < snapshot.rules.length; i++) {
      var rule = snapshot.rules[i];
      var next = rule;
      var price = pricesById[rule.coingeckoId];
      if (rule.armed && typeof price === 'string' && DECIMAL.test(price)) {
        var met =
          rule.direction === 'below'
            ? cmpDec(price, rule.thresholdEur) <= 0
            : cmpDec(price, rule.thresholdEur) >= 0;
        var gapOk =
          rule.lastTriggeredAtMs === null || nowMs - rule.lastTriggeredAtMs >= snapshot.minGapMs;
        if (met && gapOk) {
          next = {
            id: rule.id,
            asset: rule.asset,
            coingeckoId: rule.coingeckoId,
            direction: rule.direction,
            thresholdEur: rule.thresholdEur,
            pruEur: rule.pruEur,
            armed: false,
            lastTriggeredAtMs: nowMs,
            triggerCount: rule.triggerCount + 1,
          };
          fires.push({
            ruleId: rule.id,
            asset: rule.asset,
            direction: rule.direction,
            thresholdEur: rule.thresholdEur,
            priceEur: price,
            pruEur: rule.pruEur,
            atMs: nowMs,
          });
        }
      }
      rules.push(next);
    }
    return { fires: fires, rules: rules };
  }

  root.AlertSyncCore = { cmpDec: cmpDec, decideFires: decideFires };
})(self);
