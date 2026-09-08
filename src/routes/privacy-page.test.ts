/**
 * L'écran Confidentialité nomme-t-il toutes les origines réellement contactées ?
 *
 * **Il ne les nommait pas.** Deux flux ajoutés le 08/09/2026 — les cours de titres chez Twelve Data
 * et Alpha Vantage — envoient la liste des actions détenues, accompagnée d'une clé qui rattache la
 * requête à un compte identifié, là où l'appel crypto reste anonyme. La page n'en disait rien, et
 * rien ne l'obligeait à le dire : la CSP et le catalogue des sources ont chacun leur garde-fou,
 * pas elle (décision n° 128).
 *
 * Une origine ajoutée sans un mot sur cette page ne provoque aucune erreur. Elle élargit
 * simplement, en silence, ce que l'utilisateur laisse voir de lui.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_ORIGINS } from '../lib/support/csp';

const PAGE = readFileSync('src/routes/Privacy.svelte', 'utf8');

/** Hôte d'une origine, sans schéma : c'est ainsi que la page les cite. */
const hostOf = (origin: string): string => origin.replace(/^[a-z]+:\/\//, '');

/**
 * Origines que la page n'a pas à citer une par une, et pourquoi.
 *
 * La liste est **explicite et justifiée** : une exemption muette rouvrirait exactement le trou que
 * ce test ferme.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  // Citée par sa chaîne, pas par son hôte : « l'API de sa propre chaîne ».
  'blockstream.info': 'repli Bitcoin, même donnée et même phrase que mempool.space',
  'api.blockscout.com': 'repli EVM, couvert par la phrase sur les explorateurs de chaîne',
  'api.routescan.io': 'repli EVM, idem',
  'api.etherscan.io': 'explorateur EVM optionnel, couvert par la même phrase',
  // Aucune donnée personnelle ne part : ni actif, ni adresse, ni identifiant.
  'api.frankfurter.dev': 'taux de change : des paires de devises, rien de personnel',
  'api.frankfurter.app': 'miroir du précédent',
};

describe('écran Confidentialité', () => {
  it('nomme chaque origine que l’application contacte', () => {
    const missing = KNOWN_ORIGINS.filter((o) => o.use === 'connect')
      .map((o) => hostOf(o.origin))
      .filter((host, i, all) => all.indexOf(host) === i)
      .filter((host) => !(host in EXEMPT) && !PAGE.includes(host));
    expect(missing, `origines contactées mais absentes de la page : ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('dit lesquelles vous identifient, plutôt que de les mettre sur le même plan', () => {
    // Une clé d'API rattache la requête à une inscription : ce n'est pas le même risque qu'un
    // appel anonyme, et la page doit le distinguer au lieu de tout ranger sous « des services
    // voient votre adresse IP ».
    expect(PAGE).toMatch(/ne sont pas anonymes|vous identifie/i);
  });

  it('les exemptions restent justifiées : aucune ne survit à la disparition de son origine', () => {
    // Garde-fou du garde-fou : une exemption pour une origine qui n'existe plus est du bruit, et
    // ce bruit finit par couvrir une vraie omission.
    const declared = new Set(KNOWN_ORIGINS.map((o) => hostOf(o.origin)));
    const stale = Object.keys(EXEMPT).filter((host) => !declared.has(host));
    expect(stale, `exemptions sans origine correspondante : ${stale.join(', ')}`).toEqual([]);
  });
});
