/** Liens publics du projet (dépôt, signalement, site). */
export const REPO_URL = 'https://github.com/jeremyH974/cout-revient-ch';
export const NEW_ISSUE_URL = `${REPO_URL}/issues/new/choose`;
export const SITE_URL = 'https://jeremyh974.github.io/cout-revient-ch/';

export type IssueTemplate = 'bug' | 'fichier-non-reconnu' | 'idee';

/** Au-delà, GitHub répond « 414 URI Too Long » ; on tronque le diagnostic plutôt que d'échouer. */
const MAX_URL_LENGTH = 6000;
const TRUNCATED = '\n… (tronqué : collez le diagnostic complet copié depuis l’application)';

/**
 * URL d'un formulaire d'issue GitHub pré-rempli : les champs `input`/`textarea` sont renseignés par
 * leur `id` (`?template=bug.yml&diagnostic=…`) ; les cases à cocher et listes restent à compléter.
 */
export function issueUrl(
  template: IssueTemplate,
  fields: Record<string, string>,
  title?: string,
): string {
  const build = (diagnostic: string | undefined): string => {
    const params = new URLSearchParams({ template: `${template}.yml` });
    if (title) params.set('title', title);
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'diagnostic') continue;
      params.set(key, value);
    }
    if (diagnostic !== undefined) params.set('diagnostic', diagnostic);
    return `${REPO_URL}/issues/new?${params.toString()}`;
  };
  let diagnostic = fields['diagnostic'];
  let url = build(diagnostic);
  while (url.length > MAX_URL_LENGTH && diagnostic !== undefined && diagnostic.length > 200) {
    diagnostic = diagnostic.slice(0, Math.floor(diagnostic.length * 0.8)).trimEnd() + TRUNCATED;
    url = build(diagnostic);
  }
  return url;
}
