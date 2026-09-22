import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hlcCompare, hlcMax, hlcTick, parseHlc } from './hlc';

describe('hlc — horloge logique hybride', () => {
  it("'' (hérité) est plus petit que toute horloge réelle", () => {
    expect(hlcCompare('', hlcTick('', 1_700_000_000_000, 'd1'))).toBeLessThan(0);
    expect(hlcMax('', '1700000000000.0000.d1')).toBe('1700000000000.0000.d1');
    expect(hlcMax('1700000000000.0000.d1', '')).toBe('1700000000000.0000.d1');
    expect(hlcMax('', '')).toBe('');
  });

  it('parseHlc : forme bien construite, null pour héritée ou illisible', () => {
    expect(parseHlc('')).toBeNull();
    expect(parseHlc('pas une horloge')).toBeNull();
    expect(parseHlc('1700000000000.0007.device-a')).toEqual({
      wallMs: 1_700_000_000_000,
      counter: 7,
      deviceId: 'device-a',
    });
  });

  it('parseHlc : ancré aux DEUX bouts — un préfixe ou un suffixe qui ne colle pas rend null', () => {
    // Préfixe étranger avant les 13 chiffres : sans l'ancre de début, le moteur de regex pourrait
    // trouver une correspondance plus loin dans la chaîne et l'accepter à tort.
    expect(parseHlc('X1700000000000.0007.device-a')).toBeNull();
    // Suffixe étranger APRÈS le nom d'appareil, sur une autre ligne : `.` ne traverse pas `\n`, donc
    // sans l'ancre de fin, la capture s'arrêterait avant le retour à la ligne et accepterait quand
    // même la chaîne — en ignorant silencieusement le reste.
    expect(parseHlc('1700000000000.0007.device-a\ngarbage')).toBeNull();
  });

  it('hlcTick : mur = max(maintenant, mur précédent), compteur +1 à mur égal, 0 sinon', () => {
    const a = hlcTick('', 1_000, 'd1');
    expect(parseHlc(a)).toEqual({ wallMs: 1_000, counter: 0, deviceId: 'd1' });
    // Même instant murale (une horloge système qui n'avance pas encore, ou deux écritures dans le
    // même flush) : le compteur distingue les deux écritures.
    const b = hlcTick(a, 1_000, 'd1');
    expect(parseHlc(b)).toEqual({ wallMs: 1_000, counter: 1, deviceId: 'd1' });
    // Le temps avance : le compteur repart de zéro.
    const c = hlcTick(b, 2_000, 'd1');
    expect(parseHlc(c)).toEqual({ wallMs: 2_000, counter: 0, deviceId: 'd1' });
    // Horloge système en retard sur la dernière vue (cas courant après une fusion) : le mur logique
    // ne recule jamais, seul le compteur avance.
    const d = hlcTick(c, 500, 'd1');
    expect(parseHlc(d)).toEqual({ wallMs: 2_000, counter: 1, deviceId: 'd1' });
  });

  it('hlcTick : premier tick au mur 0 (horloge héritée ET wallNowMs=0) ne plante pas et compte depuis zéro', () => {
    // Cas dégénéré où `prevWall` (0, faute d'horloge antérieure) et `wallNowMs` (0) coïncident :
    // le code lit alors `prev?.counter` sur un `prev` qui vaut `null`.
    const first = hlcTick('', 0, 'd1');
    expect(parseHlc(first)).toEqual({ wallMs: 0, counter: 0, deviceId: 'd1' });
  });

  it('hlcTick : les ticks successifs sont strictement croissants (hlcCompare)', () => {
    let clock = '';
    for (let i = 0; i < 200; i++) {
      const next = hlcTick(clock, 1_700_000_000_000 + (i % 3), 'd1');
      expect(hlcCompare(next, clock)).toBeGreaterThan(0);
      clock = next;
    }
  });

  it("débordement du compteur (>= 10000 ticks au même mur logique) : le mur avance d'une unité plutôt que de déborder sur un cinquième chiffre", () => {
    let clock = '';
    for (let i = 0; i < 10_005; i++) {
      const next = hlcTick(clock, 1_700_000_000_000, 'd1');
      expect(hlcCompare(next, clock)).toBeGreaterThan(0);
      // Largeur fixe : toujours 13 + 1 + 4 + 1 + longueur de l'id.
      expect(next).toMatch(/^\d{13}\.\d{4}\.d1$/);
      clock = next;
    }
    expect(parseHlc(clock)?.wallMs).toBe(1_700_000_000_001);
    expect(parseHlc(clock)?.counter).toBe(4);
  });

  it('hlcCompare/hlcMax : ordre simple, jamais localeCompare (décision n° 81) — sensible à la casse comme un identifiant hexadécimal', () => {
    // Un UUID n'a pas de lettre majuscule, mais la fonction ne doit dépendre d'aucune locale :
    // deux horloges au même instant et compteur ne se départagent que par comparaison de chaîne.
    const a = '1700000000000.0000.aaaa';
    const b = '1700000000000.0000.bbbb';
    expect(hlcCompare(a, b)).toBeLessThan(0);
    expect(hlcMax(a, b)).toBe(b);
  });

  it('property : hlcMax(a, b) est toujours celle des deux qui compare le plus grand', () => {
    const clockArb = fc
      .tuple(
        fc.integer({ min: 0, max: 9_999_999_999_999 }),
        fc.integer({ min: 0, max: 9_999 }),
        fc.constantFrom('d1', 'd2', 'd3'),
      )
      .map(([ms, c, d]) => `${String(ms).padStart(13, '0')}.${String(c).padStart(4, '0')}.${d}`);
    const eitherArb = fc.oneof(clockArb, fc.constant(''));
    fc.assert(
      fc.property(eitherArb, eitherArb, (a, b) => {
        const max = hlcMax(a, b);
        expect(max === a || max === b).toBe(true);
        expect(hlcCompare(max, a)).toBeGreaterThanOrEqual(0);
        expect(hlcCompare(max, b)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it("property : un décalage d'horloge ne fait jamais perdre une édition postérieure — après hlcMax(local, distante) puis hlcTick, le résultat dépasse strictement tout ce qui a été vu des deux côtés", () => {
    const clockArb = fc
      .tuple(fc.integer({ min: 0, max: 4_000_000_000_000 }), fc.integer({ min: 0, max: 500 }))
      .map(([ms, c]) => `${String(ms).padStart(13, '0')}.${String(c).padStart(4, '0')}.remote`);
    fc.assert(
      fc.property(
        clockArb,
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (remoteClock, localWallNowMs) => {
          // L'appareil local est peut-être très en retard (horloge système mal réglée) : le
          // prochain tick doit malgré tout dépasser l'horloge distante déjà vue.
          const merged = hlcMax('', remoteClock);
          const nextLocal = hlcTick(merged, localWallNowMs, 'local');
          expect(hlcCompare(nextLocal, remoteClock)).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
