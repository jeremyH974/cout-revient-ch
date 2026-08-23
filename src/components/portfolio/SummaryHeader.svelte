<script lang="ts">
  import { router } from '$lib/router.svelte';
  import { app } from '../../state/app.svelte';
  import Info from '../shared/Info.svelte';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';

  const t = $derived(app.report.totals);
  const unpriced = $derived(t.unpricedAssets.length);
  const unpricedLabel = $derived(`${unpriced} actif${unpriced > 1 ? 's' : ''} sans prix`);
  const subscriptionsDeducted = $derived(
    app.state.engineSettings.includeSubscriptionsInPnl && t.subscriptionsEur.gt('0'),
  );
</script>

<section class="summary card">
  <div class="tools">
    <h2 class="title">Synthèse</h2>
    <a class="tool" href={router.href({ name: 'report' })}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        ><path
          d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        /><path
          d="M14 3v5h5M9 13h6M9 17h6"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        /></svg
      >
      Rapport PDF
    </a>
  </div>
  <div class="trio">
    <div>
      <p class="label">
        Investi <Info title="Investi">
          <p>
            Coût des unités que vous détenez encore et qui ont un prix : quantité × PRU, spread et
            frais inclus.
          </p>
          <p>
            C'est la base du latent (latent = valeur − investi). Les ventes passées n'y figurent
            plus ; le coût des actifs sans prix est indiqué à part.
          </p>
        </Info>
      </p>
      <p class="big"><Money value={t.costBasis} compact /></p>
      {#if unpriced > 0}
        <p class="note">hors <Money value={t.unpricedCostBasis} compact /> d'actifs sans prix</p>
      {/if}
    </div>
    <div>
      <p class="label">Valeur</p>
      <p class="big"><Money value={t.value} compact /></p>
      {#if unpriced > 0}
        <p class="note">hors {unpricedLabel}</p>
      {/if}
    </div>
    <div>
      <p class="label">
        P&L total <Info title="P&L total">
          <p>
            <strong>Total = réalisé + latent</strong> (+ récompenses valorisées, − abonnements Coinhouse,
            selon vos réglages). Les actifs sans prix n'y entrent pas.
          </p>
          <p>
            Réalisé : gains/pertes déjà encaissés sur vos cessions. Latent : ce que vous gagneriez
            ou perdriez en vendant tout maintenant.
          </p>
          <p>
            Le ROI rapporte ce total au <strong>capital maximal engagé</strong> : le plus d'euros que
            vous ayez eu investis en même temps (apports − retraits, au plus haut). Vendre puis racheter
            n'augmente pas la base, et un euro qui passe par l'USDC n'est compté qu'une fois.
          </p>
        </Info>
      </p>
      <p class="big"><Money value={t.total} compact sign colored strong /></p>
      <p class="note">
        ROI <Pct value={t.roi} />
        <span class="muted">sur <Money value={t.roiBase} compact /> engagés</span>
        {#if unpriced > 0}<span class="muted">&nbsp;· hors {unpricedLabel}</span>{/if}
      </p>
    </div>
  </div>
  <div class="lines">
    <p>
      Réalisé <Money value={t.realized} sign colored /> · Latent <Money
        value={t.unrealized}
        sign
        colored
      />
      {#if subscriptionsDeducted}
        · Abonnements <Money value={t.subscriptionsEur.neg()} />
        <span class="muted">(déduits du P&L)</span>
      {/if}
      {#if t.otherIncome.gt('0')}
        · Revenus <Money value={t.otherIncome} sign colored />
        <span class="muted">(récompenses)</span>
      {/if}
    </p>
    <p class="muted">
      Apports nets (espèces) <Money value={t.netCash} />
      <Info title="Apports nets (espèces)">
        <p>
          Espèces réellement entrées (achats payés en euros) moins espèces réellement sorties
          (ventes encaissées en euros), dans la devise d'affichage.
        </p>
        <p>Les échanges crypto ↔ crypto et via USDC ne comptent pas : aucun euro n'a bougé.</p>
      </Info>
      · Frais <Money value={t.feesEur} />
      {#if t.subscriptionsEur.gt('0') && !subscriptionsDeducted}
        · Abonnements <Money value={t.subscriptionsEur} /> <span class="muted">(hors P&L)</span>
      {/if}
    </p>
  </div>
</section>

<style>
  .summary {
    padding: var(--space-4);
    margin: var(--space-3);
  }
  .trio {
    display: grid;
    /* Sur téléphone : Investi et Valeur côte à côte, le P&L total (chiffre-titre) seul sur une
       deuxième ligne. Trois colonnes serrées débordaient avec les polices larges (Linux, Android)
       et faisaient dézoomer la page. */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    display: flex;
    align-items: center;
  }
  .trio > div {
    min-width: 0;
  }
  .trio > div:last-child {
    grid-column: 1 / -1;
  }
  .big {
    font-size: var(--fs-lg);
    font-weight: 650;
    margin-top: 2px;
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    margin-top: 2px;
  }
  .lines {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
    font-size: var(--fs-sm);
    display: grid;
    gap: var(--space-1);
  }
  /* Actions de synthèse : le rapport PDF doit se voir dès le haut de page, pas seulement en pied. */
  .tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .title {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  @media (min-width: 768px) {
    .trio {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .trio > div:last-child {
      grid-column: auto;
    }
    .big {
      font-size: var(--fs-xl);
    }
  }
</style>
