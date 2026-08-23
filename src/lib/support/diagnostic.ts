/**
 * Diagnostic copiable pour signaler un problème : un texte court et lisible qui ne contient
 * JAMAIS de montant, de quantité ni de message brut (les messages d'intégrité ou d'erreur de ligne
 * citent des valeurs). On ne prend que des compteurs, des statuts, des libellés et des colonnes.
 * Module pur : les informations navigateur sont collectées à part (`environment.ts`).
 */
import type { PortfolioReport, PositionReport } from '../domain/engine/report';
import type { EngineSettings, RawCoinhouseRow } from '../domain/types';
import type { ImportBatchMeta, UiSettings } from '../storage/schema';

export interface DiagnosticInput {
  version: string;
  build: string;
  /** ISO 8601. */
  now: string;
  environment: {
    userAgent: string;
    language: string;
    viewport: string;
    online: boolean | null;
    standalone: boolean | null;
  };
  storage: {
    status: 'empty' | 'ok' | 'corrupt';
    saveError: string | null;
    persisted: boolean | null;
    usageBytes: number | null;
    quotaBytes: number | null;
  };
  imports: readonly ImportBatchMeta[];
  rows: readonly RawCoinhouseRow[];
  manualEvents: number;
  report: PortfolioReport | null;
  prices: {
    source: UiSettings['priceSource'];
    online: boolean | null;
    errors: readonly string[];
    missing: readonly string[];
    lastRefreshAt: string | null;
  };
  fx: { wanted: string; effective: string; error: string | null };
  engine: EngineSettings;
  ui: Pick<UiSettings, 'theme' | 'discreet' | 'hideClosed' | 'chartMetric' | 'assetChartMetric'>;
  /** Échec d'import affiché à l'écran, le cas échéant (colonnes trouvées, jamais les lignes). */
  failure?: { error: string; header: readonly string[] } | null;
  /** Logos d'actifs qui n'ont pas pu être affichés (ticker, URL, résultat du contrôle). */
  iconFailures?: readonly { asset: string; url: string; probe: string }[];
}

const yesNo = (v: boolean | null): string => (v === null ? '?' : v ? 'oui' : 'non');
const size = (bytes: number | null): string =>
  bytes === null
    ? '?'
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} Ko`
      : `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} Mo`;
const list = (items: readonly string[], empty = 'aucune'): string =>
  items.length > 0 ? items.join(', ') : empty;
const day = (iso: string): string => iso.slice(0, 10);

/** « Echange ×196, Abonnement ×3 » : libellés seuls, triés par fréquence. */
function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label || '(vide)'} ×${n}`);
  return parts.length > 0 ? parts.join(', ') : 'aucun';
}

function integrityLine(report: PortfolioReport): string {
  const all: PositionReport[] = [
    ...report.positions,
    ...report.stablecoins,
    ...report.closed,
    ...report.blocked,
  ];
  const checked = all.filter((p) => p.integrity !== null);
  if (checked.length === 0) return 'non vérifiée';
  const ok = checked.filter((p) => p.integrity?.status === 'ok').length;
  const others = checked
    .filter((p) => p.integrity !== null && p.integrity.status !== 'ok')
    .map((p) => `${p.asset} : ${p.integrity?.status ?? '?'}`);
  const reordered = checked
    .filter((p) => (p.integrity?.reorderedDays.length ?? 0) > 0)
    .map((p) => p.asset);
  const parts = [`ok ×${ok}`];
  if (others.length > 0) parts.push(others.join(', '));
  if (reordered.length > 0) parts.push(`règlement réordonné : ${reordered.join(', ')}`);
  return parts.join(' · ');
}

export function buildDiagnostic(input: DiagnosticInput): string {
  const { environment: env, storage, report } = input;
  const lines: string[] = [
    'Coût de revient CH — diagnostic (ne contient ni montant ni quantité)',
    `Version : ${input.version} (build ${input.build}) · généré le ${input.now.slice(0, 19).replace('T', ' ')} UTC`,
    `Navigateur : ${env.userAgent}`,
    `Langue : ${env.language} · écran : ${env.viewport} · en ligne : ${yesNo(env.online)} · installée sur l'écran d'accueil : ${yesNo(env.standalone)}`,
    `Stockage : état ${storage.status} · persistant : ${yesNo(storage.persisted)} · usage ${size(storage.usageBytes)} / quota ${size(storage.quotaBytes)} · erreur de sauvegarde : ${storage.saveError ?? 'aucune'}`,
    `Imports : ${input.imports.length}`,
  ];
  for (const batch of input.imports) {
    lines.push(
      `  - ${day(batch.at)} · ${batch.fileName} · ${batch.rows} ligne(s) dont ${batch.newRows} nouvelle(s) · format ${batch.format ?? 'inconnu'}`,
    );
    lines.push(
      `    colonnes : ${batch.header ? list(batch.header) : 'inconnues (import antérieur)'} · inconnues : ${list(batch.unknownColumns ?? [])}`,
    );
  }
  lines.push(
    `Lignes conservées : ${input.rows.length} · saisies manuelles : ${input.manualEvents}`,
  );
  lines.push(`Types d'opérations : ${countBy(input.rows.map((r) => r.type))}`);
  lines.push(`Comptes : ${countBy(input.rows.map((r) => r.account))}`);
  if (report) {
    lines.push(
      `Rapport : ${report.positions.length} position(s) · ${report.stablecoins.length} stablecoin(s) · ${report.closed.length} clôturée(s) · ${report.blocked.length} bloquée(s) · ${report.unqualified.length} à qualifier · sans prix : ${list(report.totals.unpricedAssets, 'aucun')} · avertissements : ${report.warnings.length}`,
    );
    if (report.unqualified.length > 0) {
      lines.push(`À qualifier (libellés) : ${countBy(report.unqualified.map((u) => u.rawType))}`);
    }
    lines.push(`Intégrité des soldes : ${integrityLine(report)}`);
  } else {
    lines.push('Rapport : aucun (pas de données)');
  }
  lines.push(
    `Prix : source ${input.prices.source} · en ligne : ${yesNo(input.prices.online)} · dernière actualisation : ${input.prices.lastRefreshAt ?? 'jamais'} · manquants : ${list(input.prices.missing, 'aucun')} · erreurs : ${list(input.prices.errors)}`,
  );
  lines.push(
    `Devise : ${input.fx.wanted} (effective ${input.fx.effective}) · change : ${input.fx.error ?? 'ok'}`,
  );
  lines.push(
    `Moteur : migration ${input.engine.migrationMode} · récompenses ${input.engine.rewardValuation} · abonnements dans le P&L : ${yesNo(input.engine.includeSubscriptionsInPnl)}`,
  );
  lines.push(
    `Affichage : thème ${input.ui.theme} · discret : ${yesNo(input.ui.discreet)} · clôturées masquées : ${yesNo(input.ui.hideClosed)} · métriques ${input.ui.chartMetric} / ${input.ui.assetChartMetric}`,
  );
  if (input.failure) {
    lines.push(`Échec d'import affiché : ${input.failure.error}`);
    lines.push(`  colonnes trouvées : ${list(input.failure.header)}`);
  }
  const icons = input.iconFailures ?? [];
  lines.push(
    `Logos : ${icons.length === 0 ? 'aucun échec' : icons.map((f) => `${f.asset} (${f.url} → ${f.probe})`).join(', ')}`,
  );
  return lines.join('\n');
}
