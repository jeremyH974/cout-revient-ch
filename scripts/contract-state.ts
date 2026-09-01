/**
 * L'état d'un contrôle de contrat, et ce qu'on en fait.
 *
 * Séparé de `api-contract.mjs` parce que celui-ci lance ses appels réseau au chargement : ce module
 * n'a aucun effet de bord, donc il est importable par les tests.
 *
 * Le sujet est plus subtil qu'il n'y paraît. Une surveillance qui ne distingue pas **le contrat
 * rompu** — un fournisseur qui a changé la forme de ses réponses, qu'un humain doit corriger dans
 * le code — du **fournisseur qui a fermé** — que personne ne peut corriger — se condamne à hurler
 * sans fin. C'est ce qui est arrivé à l'issue #38 : six runs, cinq commentaires, une seule cause
 * (l'instance publique Blockscout de Base, HTTP 500 depuis le 30/08/2026), et rien à faire.
 *
 * D'où le **sursis** : on déclare qu'un écart est connu et accepté, et il cesse de faire échouer la
 * surveillance. Le vocabulaire est déjà celui du projet — voir `docs/onchain-import.md`, « l'API
 * publique Blockscout est en sursis ».
 *
 * Un sursis qui pourrit serait pire que pas de sursis du tout : il masquerait un vrai écart. Deux
 * garde-fous l'en empêchent, et **tous deux font échouer la surveillance** parce que tous deux
 * demandent un geste que l'humain peut faire en trente secondes :
 *
 * - un sursis **expiré** doit être réexaminé ;
 * - un fournisseur **rétabli** alors qu'un sursis le couvre encore doit voir ce sursis retiré.
 */

/** Un écart connu et accepté, avec la date à laquelle il devra être réexaminé. */
export interface Sursis {
  depuis: string;
  jusquau: string;
  pourquoi: string;
}

/** Ce qu'un contrôle a constaté. */
export interface Result {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
  rateLimit: string;
  sursis?: Sursis | undefined;
}

export type State = 'ok' | 'sursis' | 'écart';

export interface Verdict {
  state: State;
  /** La surveillance doit-elle échouer à cause de ce résultat ? */
  fails: boolean;
  reason: string;
}

/**
 * Classe un résultat. `today` est passé, jamais lu de l'horloge : les tests doivent pouvoir jouer
 * n'importe quelle date.
 */
export function classify(result: Result, today: string): Verdict {
  const { ok, sursis } = result;

  if (ok && !sursis) return { state: 'ok', fails: false, reason: '' };

  if (ok && sursis) {
    // Une seule réponse réussie ne prouve pas que la cause a disparu : mesuré le 01/09/2026, Base
    // répondait 500 six fois sur sept, avec un succès isolé. En faire un échec ferait échouer la
    // surveillance au hasard — le défaut même qu'on corrige. C'est donc un **indice**, pas un
    // verdict ; la garantie anti-pourrissement reste la date d'expiration, elle non négociable.
    return {
      state: 'sursis',
      fails: false,
      reason:
        `a répondu cette fois, alors qu'un sursis le couvre depuis le ${sursis.depuis} : ` +
        `si cela se confirme, retirez-le de \`api-contract.mjs\` (réexamen dû le ${sursis.jusquau})`,
    };
  }

  if (!sursis) return { state: 'écart', fails: true, reason: result.detail };

  if (today > sursis.jusquau) {
    return {
      state: 'écart',
      fails: true,
      reason: `${result.detail} — le sursis a expiré le ${sursis.jusquau}, il doit être réexaminé`,
    };
  }

  return {
    state: 'sursis',
    fails: false,
    reason: `${result.detail} — connu depuis le ${sursis.depuis} : ${sursis.pourquoi}`,
  };
}

/** Le symbole affiché dans le tableau. */
const SYMBOLS: Record<State, string> = { ok: '✅', sursis: '⚠️', écart: '❌' };

/**
 * Une empreinte de l'état, stable à l'ordre près : deux exécutions qui constatent la même chose
 * rendent la même chaîne. C'est ce qui permet de ne commenter l'issue que sur **changement**, au
 * lieu de la recommenter toutes les six heures.
 *
 * Les délais et les en-têtes de quota en sont volontairement absents : ils changent à chaque appel
 * et n'apprennent rien.
 */
export function signature(results: readonly Result[], today: string): string {
  const notable = results
    .map((result) => ({ result, verdict: classify(result, today) }))
    .filter(({ verdict }) => verdict.state !== 'ok')
    .map(({ result, verdict }) => `${verdict.state}:${result.name}`)
    .sort();
  return notable.length === 0 ? 'tout-conforme' : notable.join('|');
}

/** Rend le rapport Markdown et dit si la surveillance doit échouer. */
export function summarise(results: readonly Result[], today: string, stampedAt: string) {
  const verdicts = results.map((result) => ({ result, verdict: classify(result, today) }));
  const failing = verdicts.filter(({ verdict }) => verdict.fails);
  const reprieved = verdicts.filter(({ verdict }) => verdict.state === 'sursis');

  const rows = verdicts.map(({ result, verdict }) => {
    const detail = (verdict.state === 'ok' ? result.detail : verdict.reason).replace(/\|/g, '/');
    return `| ${result.name} | ${SYMBOLS[verdict.state]} | ${result.ms} ms | ${detail} | ${result.rateLimit || '—'} |`;
  });

  const conclusion = [];
  if (failing.length > 0) {
    conclusion.push(
      `${failing.length} fournisseur(s) en écart : ${failing.map(({ result }) => result.name).join(', ')}.`,
    );
  }
  if (reprieved.length > 0) {
    conclusion.push(
      `${reprieved.length} en sursis, connus et acceptés : ${reprieved
        .map(({ result }) => result.name)
        .join(', ')}. La surveillance ne s'en alarme plus, mais les surveille toujours.`,
    );
  }
  if (conclusion.length === 0) {
    conclusion.push('Tous les fournisseurs répondent avec la forme attendue.');
  }

  return {
    markdown: [
      `# Contrat des API tierces — ${stampedAt}`,
      '',
      '| Fournisseur | État | Délai | Détail | Limites |',
      '| --- | --- | --- | --- | --- |',
      ...rows,
      '',
      ...conclusion,
    ].join('\n'),
    failed: failing.map(({ result }) => result.name),
    reprieved: reprieved.map(({ result }) => result.name),
    signature: signature(results, today),
    ok: failing.length === 0,
  };
}
