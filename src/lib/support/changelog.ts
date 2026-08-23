/**
 * Lecture de CHANGELOG.md (format Keep a Changelog) pour la page « Nouveautés » : parseur minimal,
 * sans HTML brut — le rendu se fait à partir de segments texte/code.
 */
export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  /** « Unreleased » ou « 1.2.0 ». */
  version: string;
  /** AAAA-MM-JJ ou null. */
  date: string | null;
  sections: ChangelogSection[];
}

const SECTION_LABELS: Record<string, string> = {
  Added: 'Ajouté',
  Changed: 'Modifié',
  Fixed: 'Corrigé',
  Security: 'Sécurité',
  Removed: 'Retiré',
  Deprecated: 'Déprécié',
};

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h2) {
      release = { version: h2[1]!, date: h2[2] ?? null, sections: [] };
      releases.push(release);
      section = null;
      continue;
    }
    const h3 = /^### (.+)$/.exec(line);
    if (h3 && release) {
      const title = SECTION_LABELS[h3[1]!.trim()] ?? h3[1]!.trim();
      // Un titre répété dans la même version (« Added » en deux endroits) fusionne ses entrées :
      // les sections d'une version restent uniques, ce qui sert de clé au rendu.
      section = release.sections.find((s) => s.title === title) ?? null;
      if (!section) {
        section = { title, items: [] };
        release.sections.push(section);
      }
      continue;
    }
    const item = /^- (.+)$/.exec(line);
    if (item && section) {
      section.items.push(item[1]!.trim());
      continue;
    }
    if (section && section.items.length > 0 && /^\s{2,}\S/.test(raw)) {
      const last = section.items.length - 1;
      section.items[last] = `${section.items[last]} ${line.trim()}`;
    }
  }
  return releases;
}

export type InlineSegment = { kind: 'text' | 'code'; value: string };

/** Découpe `texte` et `` `code` `` pour un rendu sans {@html}. */
export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const parts = text.split('`');
  parts.forEach((part, i) => {
    if (part === '') return;
    segments.push({ kind: i % 2 === 1 ? 'code' : 'text', value: part });
  });
  return segments;
}

/** Version affichable : « Dernières évolutions » pour le bloc non numéroté. */
export function releaseTitle(release: ChangelogRelease): string {
  if (release.version.toLowerCase() === 'unreleased') return 'Dernières évolutions';
  return `Version ${release.version}${release.date ? ` — ${release.date}` : ''}`;
}
