/**
 * La machine à états de la surveillance, éprouvée hors ligne.
 *
 * Ce qui est vérifié ici n'est pas « l'API répond-elle » — cela demande le réseau, et c'est le rôle
 * de `scripts/api-contract.mjs` sous le cron. C'est **la décision** : quand la surveillance doit-elle
 * échouer, et quand doit-elle se taire ? L'issue #38 a montré le coût de se tromper — six runs, cinq
 * commentaires, une cause que personne ne pouvait corriger.
 *
 * Les deux cas les plus importants sont ceux qui empêchent un sursis de pourrir : son expiration, et
 * le rétablissement du fournisseur qu'il couvre. Tous deux doivent **échouer**, parce que tous deux
 * demandent un geste que l'humain peut faire.
 */
import { describe, expect, it } from 'vitest';
import { classify, signature, summarise, type Result } from '../../scripts/contract-state.ts';

const SURSIS = {
  depuis: '2026-08-30',
  jusquau: '2027-03-01',
  pourquoi: 'instance publique éteinte',
};

const result = (over: Partial<Result> = {}): Result => ({
  name: 'Fournisseur',
  ok: true,
  detail: 'conforme',
  ms: 10,
  rateLimit: '',
  ...over,
});

describe('classement d’un contrôle', () => {
  it('conforme et sans sursis : rien à signaler', () => {
    const verdict = classify(result(), '2026-09-01');
    expect(verdict).toEqual({ state: 'ok', fails: false, reason: '' });
  });

  it('en écart sans sursis : la surveillance échoue', () => {
    const verdict = classify(result({ ok: false, detail: 'HTTP 500' }), '2026-09-01');
    expect(verdict.state).toBe('écart');
    expect(verdict.fails).toBe(true);
    expect(verdict.reason).toBe('HTTP 500');
  });

  it('en écart sous sursis en cours : signalé, sans faire échouer', () => {
    const verdict = classify(
      result({ ok: false, detail: 'HTTP 500', sursis: SURSIS }),
      '2026-09-01',
    );
    expect(verdict.state).toBe('sursis');
    expect(verdict.fails).toBe(false);
    expect(verdict.reason).toContain('HTTP 500');
    expect(verdict.reason).toContain('2026-08-30');
    expect(verdict.reason).toContain('instance publique éteinte');
  });

  it('en écart sous sursis EXPIRÉ : la surveillance échoue de nouveau', () => {
    const verdict = classify(
      result({ ok: false, detail: 'HTTP 500', sursis: SURSIS }),
      '2027-03-02',
    );
    expect(verdict.state).toBe('écart');
    expect(verdict.fails).toBe(true);
    expect(verdict.reason).toContain('le sursis a expiré le 2027-03-01');
  });

  it('le sursis court jusqu’à sa date incluse', () => {
    expect(
      classify(result({ ok: false, detail: 'HTTP 500', sursis: SURSIS }), '2027-03-01').fails,
    ).toBe(false);
  });

  /**
   * Une réponse réussie isolée n'est pas une guérison : mesuré le 01/09/2026, Base répondait 500
   * six fois sur sept. En faire un échec ferait échouer la surveillance au hasard — le défaut même
   * qu'on corrige. C'est donc signalé sans alarmer ; l'expiration reste la garantie dure.
   */
  it('rétabli alors qu’un sursis le couvre : signalé, mais sans faire échouer', () => {
    const verdict = classify(result({ ok: true, sursis: SURSIS }), '2026-09-01');
    expect(verdict.state).toBe('sursis');
    expect(verdict.fails).toBe(false);
    expect(verdict.reason).toContain('si cela se confirme, retirez-le');
    expect(verdict.reason).toContain('2027-03-01');
  });
});

describe('empreinte de l’état', () => {
  it('ne retient que ce qui n’est pas conforme, et ignore l’ordre', () => {
    const a = result({ name: 'A', ok: false, detail: 'x' });
    const b = result({ name: 'B' });
    const c = result({ name: 'C', ok: false, detail: 'y' });
    expect(signature([a, b, c], '2026-09-01')).toBe(signature([c, b, a], '2026-09-01'));
    expect(signature([a, b, c], '2026-09-01')).toBe('écart:A|écart:C');
  });

  it('distingue un écart d’un sursis sur le même fournisseur', () => {
    const brut = result({ name: 'A', ok: false, detail: 'x' });
    expect(signature([brut], '2026-09-01')).not.toBe(
      signature([{ ...brut, sursis: SURSIS }], '2026-09-01'),
    );
  });

  it('dit « tout-conforme » quand il n’y a rien à signaler', () => {
    expect(signature([result(), result({ name: 'B' })], '2026-09-01')).toBe('tout-conforme');
  });

  /** Le délai et les quotas changent à chaque appel : les inclure ferait commenter à chaque run. */
  it('ne bouge pas quand seuls le délai et les quotas changent', () => {
    const base = result({ name: 'A', ok: false, detail: 'HTTP 500' });
    expect(signature([base], '2026-09-01')).toBe(
      signature([{ ...base, ms: 9999, rateLimit: 'x-ratelimit-remaining=3' }], '2026-09-01'),
    );
  });
});

describe('rapport', () => {
  const stamp = '2026-09-01T05:00:00.000Z';

  it('un sursis seul laisse la surveillance au vert', () => {
    const report = summarise(
      [result({ name: 'A' }), result({ name: 'B', ok: false, detail: 'HTTP 500', sursis: SURSIS })],
      '2026-09-01',
      stamp,
    );
    expect(report.ok).toBe(true);
    expect(report.failed).toEqual([]);
    expect(report.reprieved).toEqual(['B']);
    expect(report.markdown).toContain('⚠️');
    expect(report.markdown).toContain('alarme plus, mais les surveille toujours');
  });

  it('un vrai écart fait échouer, même si un sursis coexiste', () => {
    const report = summarise(
      [
        result({ name: 'A', ok: false, detail: 'champ absent' }),
        result({ name: 'B', ok: false, detail: 'HTTP 500', sursis: SURSIS }),
      ],
      '2026-09-01',
      stamp,
    );
    expect(report.ok).toBe(false);
    expect(report.failed).toEqual(['A']);
    expect(report.reprieved).toEqual(['B']);
  });

  it('échappe les barres verticales, qui casseraient le tableau Markdown', () => {
    const report = summarise(
      [result({ name: 'A', ok: false, detail: 'a | b' })],
      '2026-09-01',
      stamp,
    );
    const row = report.markdown.split('\n').find((line) => line.startsWith('| A '));
    expect(row).toContain('a / b');
  });
});
