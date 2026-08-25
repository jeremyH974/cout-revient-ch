<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { alertDistance, alertThresholdEur, type AlertRule } from '$lib/domain/alerts';
  import { D } from '$lib/domain/money';
  import { fmtDateTime, fmtPct, fmtPrice, fmtRelative } from '$lib/format/fr';
  import {
    notifyPermission,
    requestNotifyPermission,
    type NotifyPermission,
  } from '$lib/notify/notifications';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import AlertRuleSheet from '../../components/alerts/AlertRuleSheet.svelte';
  import SimulateSheet from '../../components/alerts/SimulateSheet.svelte';
  import { ruleLabel } from '../../components/alerts/labels';
  import AppBar from '../../components/layout/AppBar.svelte';
  import CoinBadge from '../../components/shared/CoinBadge.svelte';
  import PriceFreshness from '../../components/shared/PriceFreshness.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  const rules = $derived(app.alertRules);
  const events = $derived(app.state.alerts.events);
  const settings = $derived(app.state.alerts.settings);

  /** Les déclenchements non lus à l'arrivée restent affichés le temps de la visite. */
  let pendingIds = $state<string[]>([]);
  onMount(() => {
    pendingIds = app.state.alerts.events.filter((e) => !e.read).map((e) => e.id);
    app.markAlertEventsRead();
  });
  const pending = $derived(events.filter((e) => pendingIds.includes(e.id)));

  let permission = $state<NotifyPermission>(notifyPermission());
  async function enableSystemNotifications(): Promise<void> {
    permission = await requestNotifyPermission();
    if (permission === 'granted') {
      app.setAlertsSettings({ systemNotifications: true });
      toasts.push('Notifications système activées.', 'success');
    } else if (permission === 'denied') {
      toasts.push(
        'Notifications refusées par le navigateur : le centre d’alertes in-app reste actif.',
        'error',
      );
    }
  }

  // Feuilles (création/édition d'alerte, simulateur).
  let sheetOpen = $state(false);
  let sheetRule = $state<AlertRule | null>(null);
  let sheetAsset = $state('');
  function openCreate(asset = ''): void {
    sheetRule = null;
    sheetAsset = asset;
    sheetOpen = true;
  }
  function openEdit(rule: AlertRule): void {
    sheetRule = rule;
    sheetAsset = rule.asset;
    sheetOpen = true;
  }
  let simOpen = $state(false);
  let simAsset = $state('btc');
  let simPrice = $state<string | null>(null);
  let simMode = $state<'buy' | 'sell' | 'target'>('buy');
  function openSim(asset: string, price: string | null, mode: 'buy' | 'sell' | 'target'): void {
    simAsset = asset;
    simPrice = price;
    simMode = mode;
    simOpen = true;
  }

  /** Suppression en deux temps, sans boîte de dialogue bloquante. */
  let confirmingId = $state<string | null>(null);
  function removeRule(id: string): void {
    if (confirmingId !== id) {
      confirmingId = id;
      setTimeout(() => {
        if (confirmingId === id) confirmingId = null;
      }, 5000);
      return;
    }
    confirmingId = null;
    app.removeAlertRule(id);
    toasts.push('Alerte supprimée.');
  }

  const thresholdOf = (rule: AlertRule) =>
    alertThresholdEur(rule, app.alertPositions[rule.asset] ?? null);
  const freshPriceOf = (asset: string): string | null => {
    const quote = app.quotes[asset];
    return quote && !quote.stale ? quote.priceEur : null;
  };

  interface RuleStatus {
    text: string;
    tone: 'ok' | 'muted' | 'warn';
  }
  function statusOf(rule: AlertRule): RuleStatus {
    if (!rule.enabled) return { text: 'en pause', tone: 'muted' };
    if (thresholdOf(rule) === null) return { text: 'dormante — PRU indisponible', tone: 'warn' };
    const state = app.state.alerts.states[rule.id];
    if (!state || state.armed) return { text: 'armée', tone: 'ok' };
    if (state.lastTriggeredAtMs !== null)
      return {
        text: `déclenchée ${fmtRelative(new Date(state.lastTriggeredAtMs).toISOString(), nowMs())}`,
        tone: 'warn',
      };
    return { text: 's’armera au re-franchissement', tone: 'muted' };
  }
</script>

<AppBar title="Alertes" back />

{#if !app.hasData}
  <section class="card empty">
    <h2>Alertes de prix relatives au PRU</h2>
    <p class="muted">
      Importez d’abord vos opérations : vous pourrez alors être prévenu quand un actif passe sous
      votre PRU, atteint un objectif de plus-value (même net de frais), ou franchit un prix exact.
    </p>
    <p>
      <a href={router.href({ name: 'import' })}>Importer un export</a> ·
      <a href={router.href({ name: 'welcome' })}>Essayer la démo</a>
    </p>
  </section>
{:else}
  <section class="card">
    <div class="head-row">
      <h2>Surveillance</h2>
      <button class="primary" type="button" onclick={() => openCreate()}>Créer une alerte</button>
    </div>
    <PriceFreshness />
    <p class="muted small">
      {app.armedAlertCount} alerte{app.armedAlertCount > 1 ? 's' : ''} armée{app.armedAlertCount > 1
        ? 's'
        : ''} · les seuils relatifs suivent votre PRU : un nouvel achat les déplace d’eux-mêmes.
    </p>
    <label class="toggle">
      <input
        type="checkbox"
        checked={settings.watch}
        onchange={(e) => app.setAlertsSettings({ watch: e.currentTarget.checked })}
      />
      <span>Veille automatique des prix (app ouverte)</span>
    </label>
    <label class="field-inline">
      <span>Cadence</span>
      <select
        value={String(settings.watchMinutes)}
        disabled={!settings.watch}
        onchange={(e) => app.setAlertsSettings({ watchMinutes: Number(e.currentTarget.value) })}
      >
        <option value="1">1 min</option>
        <option value="2">2 min</option>
        <option value="5">5 min</option>
        <option value="15">15 min</option>
      </select>
    </label>
    {#if app.state.ui.priceSource === 'off'}
      <p class="warn small">
        Les prix automatiques sont désactivés dans les réglages : la veille ne peut pas tourner.
      </p>
    {/if}
    <div class="notif">
      {#if permission === 'unsupported'}
        <p class="muted small">Notifications système non prises en charge par ce navigateur.</p>
      {:else if settings.systemNotifications && permission === 'granted'}
        <p class="small">
          Notifications système : <strong>activées</strong>
          <button
            class="link"
            type="button"
            onclick={() => app.setAlertsSettings({ systemNotifications: false })}>désactiver</button
          >
        </p>
      {:else}
        <button class="secondary" type="button" onclick={() => void enableSystemNotifications()}
          >Activer les notifications système</button
        >
        {#if permission === 'denied'}
          <p class="warn small">
            Le navigateur bloque les notifications pour ce site (réglages du site à modifier).
          </p>
        {/if}
      {/if}
    </div>
    <p class="muted small">
      100 % local : vos seuils ne quittent jamais ce navigateur. En contrepartie, les alertes ne
      s’évaluent que quand l’app est ouverte (onglet ou PWA installée, même en arrière-plan) — pas
      de serveur, donc pas de notification app fermée. Sur iPhone/iPad, installez l’app sur l’écran
      d’accueil pour recevoir les notifications.
    </p>
  </section>

  {#if pending.length > 0}
    <section class="card fired">
      <h2>Déclenchées récemment</h2>
      <ul class="events">
        {#each pending as event (event.id)}
          <li>
            <CoinBadge asset={event.asset} />
            <div class="event-body">
              <p>
                <strong>{event.asset.toUpperCase()}</strong>
                {event.direction === 'below' ? 'est passé sous' : 'a atteint'} le seuil
                {fmtPrice(event.thresholdEur)} — prix {fmtPrice(event.priceEur)}{#if event.pruEur}
                  <span class="muted"> · PRU {fmtPrice(event.pruEur)}</span>{/if}
              </p>
              <p class="muted small">{fmtDateTime(event.at.slice(0, 19))}</p>
              <p class="event-actions">
                {#if event.direction === 'below'}
                  <button
                    class="link"
                    type="button"
                    onclick={() => openSim(event.asset, event.priceEur, 'buy')}
                    >Simuler un rachat à ce prix</button
                  >
                {:else}
                  <button
                    class="link"
                    type="button"
                    onclick={() => openSim(event.asset, event.priceEur, 'sell')}
                    >Simuler une vente à ce prix</button
                  >
                {/if}
                · <a href={router.href({ name: 'asset', asset: event.asset })}>voir l’actif</a>
              </p>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <h2>Règles ({rules.length})</h2>
    {#if rules.length === 0}
      <p class="muted">
        Aucune alerte pour le moment. Exemples : « préviens-moi si BTC passe 10 % sous mon PRU », «
        objectif +25 % net de frais de vente », « ETH atteint 5 000 € ».
      </p>
    {:else}
      <ul class="rules">
        {#each rules as rule (rule.id)}
          {@const threshold = thresholdOf(rule)}
          {@const price = freshPriceOf(rule.asset)}
          {@const status = statusOf(rule)}
          <li class="rule" class:disabled={!rule.enabled}>
            <CoinBadge asset={rule.asset} />
            <div class="rule-body">
              <p>
                <strong>{rule.asset.toUpperCase()}</strong>
                <span class="muted small">{assetName(rule.asset)}</span> — {ruleLabel(rule)}
                {#if rule.repeat === 'recurring'}<span class="muted small"> · récurrente</span>{/if}
              </p>
              <p class="small">
                {#if threshold !== null}
                  Seuil : <strong>{fmtPrice(threshold)}</strong>
                  {#if price !== null}
                    {@const distance = alertDistance(D(price), threshold)}
                    <span class="muted"
                      >· prix {fmtPrice(price)}{#if distance !== null}
                        ({fmtPct(distance)}){/if}</span
                    >
                  {/if}
                {/if}
                <span class="status {status.tone}">{status.text}</span>
              </p>
              {#if rule.note}<p class="muted small">{rule.note}</p>{/if}
            </div>
            <div class="rule-actions">
              {#if rule.enabled && !(app.state.alerts.states[rule.id]?.armed ?? true) && threshold !== null}
                <button class="link" type="button" onclick={() => app.rearmAlertRule(rule.id)}
                  >Réarmer</button
                >
              {/if}
              <button
                class="link"
                type="button"
                onclick={() => app.setAlertRuleEnabled(rule.id, !rule.enabled)}
                >{rule.enabled ? 'Suspendre' : 'Réactiver'}</button
              >
              <button class="link" type="button" onclick={() => openEdit(rule)}>Modifier</button>
              <button class="link danger" type="button" onclick={() => removeRule(rule.id)}
                >{confirmingId === rule.id ? 'Confirmer ?' : 'Supprimer'}</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if events.length > 0}
    <details class="card history">
      <summary>Historique des déclenchements ({events.length})</summary>
      <ul class="events">
        {#each events as event (event.id)}
          <li>
            <div class="event-body">
              <p class="small">
                {fmtDateTime(event.at.slice(0, 19))} — <strong>{event.asset.toUpperCase()}</strong>
                {event.direction === 'below' ? 'sous' : 'au-dessus de'}
                {fmtPrice(event.thresholdEur)} (prix {fmtPrice(event.priceEur)})
              </p>
            </div>
          </li>
        {/each}
      </ul>
      <p>
        <button class="link" type="button" onclick={() => app.clearAlertEvents()}
          >Effacer l’historique</button
        >
      </p>
    </details>
  {/if}
{/if}

<AlertRuleSheet bind:open={sheetOpen} asset={sheetAsset} rule={sheetRule} />
<SimulateSheet bind:open={simOpen} asset={simAsset} initialPrice={simPrice} initialMode={simMode} />

<style>
  .card {
    margin: var(--space-3) var(--space-3) 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  .card:last-of-type {
    margin-bottom: var(--space-4);
  }
  h2 {
    font-size: var(--fs-md);
    margin: 0;
  }
  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-4);
    font-weight: 700;
    min-height: var(--tap);
  }
  .secondary {
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    padding: 0 var(--space-3);
    font-weight: 600;
    min-height: var(--tap);
    justify-self: start;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    font-size: var(--fs-sm);
  }
  .field-inline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .field-inline select {
    min-height: 40px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-2);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  .notif {
    display: grid;
    gap: var(--space-1);
  }
  /* Cibles tactiles ≥ 24 px (WCAG 2.2 AA, target-size), même pour les liens en fs-xs. */
  .link {
    color: var(--accent);
    text-decoration: underline;
    font-size: inherit;
    min-height: 24px;
    display: inline-flex;
    align-items: center;
  }
  .link.danger {
    color: var(--loss);
  }
  .events,
  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .events li {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .event-body {
    display: grid;
    gap: 2px;
    font-size: var(--fs-sm);
    min-width: 0;
  }
  .event-actions {
    font-size: var(--fs-xs);
  }
  .fired {
    border-left: 4px solid var(--accent);
  }
  .rule {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--space-3);
  }
  .rule:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .rule.disabled .rule-body {
    opacity: 0.6;
  }
  .rule-body {
    flex: 1;
    display: grid;
    gap: 2px;
    font-size: var(--fs-sm);
    min-width: 0;
  }
  .rule-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .status {
    margin-left: var(--space-2);
    font-size: var(--fs-xs);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
  }
  .status.ok {
    color: var(--gain);
  }
  .status.muted {
    color: var(--fg-muted);
  }
  .status.warn {
    color: var(--warn);
  }
  .empty {
    text-align: center;
  }
  .history summary {
    cursor: pointer;
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  @media (min-width: 768px) {
    .card {
      margin-left: auto;
      margin-right: auto;
      max-width: 720px;
    }
  }
</style>
