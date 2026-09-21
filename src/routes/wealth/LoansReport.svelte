<script lang="ts">
  /**
   * Le rapport de prêts (décision n° 178).
   *
   * Il reprend l'écran Prêts, ni plus ni moins — ce qu'il devrait contenir au-delà reste une
   * décision du propriétaire. L'écran lit les mêmes trois sources que l'écran Prêts (le résumé, le
   * rapport du moteur et le TRI), convertit les montants de l'euro vers la devise d'affichage par
   * `displayFromEur`, comme lui, et passe le tout au constructeur de modèle.
   */
  import { nowIso } from '$lib/clock';
  import { D, type DecimalString } from '$lib/domain/money';
  import { buildLendingReportModel } from '$lib/export/lending-report-model';
  import type { ReportModel } from '$lib/export/report-model';
  import { reportAt } from '$lib/reports';
  import { router } from '$lib/router.svelte';
  import ReportShell from '../../components/report/ReportShell.svelte';
  import { app } from '../../state/app.svelte';

  const report = reportAt('loansReport')!;
  let generatedAt = $state(nowIso());

  const eur = (value: DecimalString | null) => app.displayFromEur(value);
  const ratio = (value: DecimalString | null) => (value === null ? null : D(value));

  const model = $derived.by((): ReportModel | null => {
    if (!app.hasLending) return null;
    const s = app.lending;
    const r = app.lendingReport;
    const byBorrower = r.concentration.byBorrower;
    return buildLendingReportModel(
      {
        netContributions: eur(s.netContributions),
        result: eur(s.result),
        value: eur(s.value),
        deposits: eur(s.deposits),
        withdrawals: eur(s.withdrawals),
        bonus: eur(s.bonus),
        principalLent: eur(s.principalLent),
        outstanding: eur(s.outstanding),
        accrued: eur(s.accrued),
        cash: eur(s.cash),
        interestGross: eur(s.interestGross),
        withheld: eur(s.withheld),
        interestNet: eur(s.interestNet),
        taxDebitedFromWallet: eur(s.taxDebitedFromWallet),
        writtenOff: eur(s.writtenOff),
        recycling: ratio(s.recycling),
        returnOnContributions: ratio(s.returnOnContributions),
        xirrNet: app.lendingPerf.net,
        xirrGross: app.lendingPerf.gross,
        accrualUnavailable: r.totals.accrualUnavailable,
        concentration: {
          index: ratio(byBorrower.index),
          effectiveCount: ratio(byBorrower.effectiveCount),
          top: byBorrower.top.map((row) => ({
            key: row.key,
            outstanding: eur(row.outstanding),
            weight: D(row.weight),
          })),
        },
      },
      {
        discreet: app.state.ui.discreet,
        currency: app.currency,
        generatedAt,
        version: __APP_VERSION__,
      },
    );
  });
</script>

<ReportShell {report} {model} stamp={() => (generatedAt = nowIso())}>
  {#snippet empty()}
    <h2>Rien à rapporter pour l’instant</h2>
    <p class="muted">
      Ce rapport s’appuie sur vos prêts de financement participatif. Importez votre relevé, et il se
      remplira.
    </p>
    <a class="secondary" href={router.href({ name: 'loans' })}>Aller aux prêts</a>
  {/snippet}
</ReportShell>
