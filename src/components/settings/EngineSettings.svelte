<script lang="ts">
  import { app } from '../../state/app.svelte';

  const set = (patch: Partial<typeof app.state.engineSettings>): void => {
    app.state.engineSettings = { ...app.state.engineSettings, ...patch };
  };
</script>

<section class="card group">
  <h2>Méthode de calcul</h2>
  <label class="field"
    >Migration d'un actif (ex. MKR → SKY)
    <select
      value={app.state.engineSettings.migrationMode}
      onchange={(e) => set({ migrationMode: e.currentTarget.value as 'carry-cost' | 'realize' })}
    >
      <option value="carry-cost">Reporter le coût (aucune plus-value constatée)</option>
      <option value="realize">Réaliser à la valeur du jour</option>
    </select>
  </label>
  <label class="field"
    >Récompenses (staking, airdrops)
    <select
      value={app.state.engineSettings.rewardValuation}
      onchange={(e) => set({ rewardValuation: e.currentTarget.value as 'zero' | 'fair-value' })}
    >
      <option value="zero">Coût 0 € (tout est latent)</option>
      <option value="fair-value">Valeur du jour à la réception (revenu)</option>
    </select>
  </label>
  <label class="check"
    ><input
      type="checkbox"
      checked={app.state.engineSettings.includeSubscriptionsInPnl}
      onchange={(e) => set({ includeSubscriptionsInPnl: e.currentTarget.checked })}
    /> Déduire les abonnements Coinhouse du P&L total</label
  >
</section>

<style>
  .group {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap);
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  select {
    width: 100%;
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
  }
  .field {
    min-width: 0;
  }
</style>
