<script lang="ts">
  import { app } from '../../state/app.svelte';
  import Switch from '../shared/Switch.svelte';

  const set = (patch: Partial<typeof app.state.engineSettings>): void => {
    app.state.engineSettings = { ...app.state.engineSettings, ...patch };
  };
</script>

<details class="card group" id="methode-calcul">
  <summary><h2>Méthode de calcul</h2></summary>
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
  <Switch
    checked={app.state.engineSettings.includeSubscriptionsInPnl}
    onCheckedChange={(v) => set({ includeSubscriptionsInPnl: v })}
    label="Déduire les abonnements Coinhouse du P&L total"
  />
</details>

<style>
  .group {
    display: grid;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
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
