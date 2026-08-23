<script lang="ts">
  import { app } from '../../state/app.svelte';
  import Info from '../shared/Info.svelte';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';

  const t = $derived(app.report.totals);
</script>

<section class="summary card">
  <div class="trio">
    <div>
      <p class="label">
        Investi <Info title="Investi">
          <p>Coût des unités que vous détenez encore : quantité × PRU, spread et frais inclus.</p>
          <p>C'est la base du gain/perte latent. Les ventes passées n'y figurent plus.</p>
        </Info>
      </p>
      <p class="big"><Money value={t.costBasis} compact /></p>
    </div>
    <div>
      <p class="label">Valeur</p>
      <p class="big"><Money value={t.value} compact /></p>
      {#if t.unpricedAssets.length > 0}
        <p class="note">
          hors {t.unpricedAssets.length} actif{t.unpricedAssets.length > 1 ? 's' : ''} sans prix
        </p>
      {/if}
    </div>
    <div>
      <p class="label">
        P&L total <Info title="P&L total">
          <p>
            <strong>Total = réalisé + latent</strong> (+ récompenses valorisées, le cas échéant).
          </p>
          <p>
            Réalisé : gains/pertes déjà encaissés sur vos ventes. Latent : ce que vous gagneriez ou
            perdriez en vendant tout maintenant.
          </p>
          <p>
            Le ROI rapporte ce total à <strong>tout ce que vous avez acheté</strong> (spread et frais
            inclus) : il ne se déforme pas quand vous rachetez ou vendez une partie.
          </p>
        </Info>
      </p>
      <p class="big"><Money value={t.total} compact sign colored strong /></p>
      <p class="note">
        ROI <Pct value={t.roi} />
        <span class="muted">sur <Money value={t.investedTotal} compact /> achetés</span>
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
    </p>
    <p class="muted">
      Apports nets <Money value={t.netCash} />
      <Info title="Apports nets en euros">
        <p>
          Euros réellement entrés (achats payés en euros) moins euros réellement sortis (ventes
          encaissées en euros).
        </p>
        <p>Les échanges crypto ↔ crypto et via USDC ne comptent pas : aucun euro n'a bougé.</p>
      </Info>
      · Frais <Money value={t.feesEur} />
      {#if t.subscriptionsEur.gt('0')}
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
