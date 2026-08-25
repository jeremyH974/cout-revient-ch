<script lang="ts">
  import { nowMs } from '$lib/clock';
  import { operationsToCsv } from '$lib/export/csv-export';
  import { downloadText } from '$lib/export/download';
  import { fmtRelative, localDay } from '$lib/format/fr';
  import { fmtPrice as fmtPriceBase } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import AlertRuleSheet from '../../components/alerts/AlertRuleSheet.svelte';
  import SimulateSheet from '../../components/alerts/SimulateSheet.svelte';
  import CalcTab from '../../components/asset/CalcTab.svelte';
  import HistoryTab from '../../components/asset/HistoryTab.svelte';
  import LotsTab from '../../components/asset/LotsTab.svelte';
  import EvolutionCard from '../../components/charts/EvolutionCard.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import CoinBadge from '../../components/shared/CoinBadge.svelte';
  import Money from '../../components/shared/Money.svelte';
  import Pct from '../../components/shared/Pct.svelte';
  import Qty from '../../components/shared/Qty.svelte';
  import Sheet from '../../components/shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);

  let { asset }: { asset: string } = $props();
  let tab = $state<'lots' | 'history' | 'calc'>('history');
  let priceSheet = $state(false);
  let manualPrice = $state('');
  let alertSheet = $state(false);
  let simulateSheet = $state(false);
  const assetAlertCount = $derived(app.alertRules.filter((r) => r.asset === asset).length);

  const position = $derived(
    [
      ...app.report.positions,
      ...app.report.stablecoins,
      ...app.report.closed,
      ...app.report.blocked,
    ].find((p) => p.asset === asset) ?? null,
  );

  function saveManualPrice(): void {
    const value = manualPrice.trim().replace(',', '.');
    if (value === '') {
      app.setManualPrice(asset, null);
      toasts.push('Prix manuel supprimé.');
    } else if (/^\d+(\.\d+)?$/.test(value)) {
      app.setManualPrice(asset, value);
      toasts.push('Prix manuel enregistré.', 'success');
    } else {
      toasts.push('Prix invalide.', 'error');
      return;
    }
    priceSheet = false;
  }
</script>

<AppBar title={asset.toUpperCase()} back />

{#if !position}
  <p class="empty muted">
    Aucune donnée pour {asset.toUpperCase()}.
    <a href={router.href({ name: 'portfolio' })}>Retour au portefeuille</a>
  </p>
{:else}
  {@const p = position}
  <header class="hero">
    <div class="title">
      <CoinBadge asset={p.asset} size={44} />
      <div>
        <h2>{assetName(p.asset)} <span class="muted">· {p.asset.toUpperCase()}</span></h2>
        <p class="price">
          {#if p.closed}
            <span class="muted">Position clôturée{p.dust ? ' (résidu valorisé)' : ''}</span>
          {:else if p.price}
            {price(p.price.priceEur)}
            <span class="muted small"
              >{p.price.source} · {fmtRelative(p.price.at, nowMs())}{p.price.stale
                ? ' (périmé)'
                : ''}</span
            >
          {:else}
            <span class="muted">Prix indisponible</span>
          {/if}
          {#if !p.closed}
            <button class="link" type="button" onclick={() => (priceSheet = true)}
              >{app.assetSettings(asset).manualPriceEur
                ? 'modifier le prix manuel'
                : 'saisir un prix'}</button
            >
          {/if}
        </p>
      </div>
    </div>
    {#if p.blocked}
      <p class="warn">{p.warnings[0]}</p>
    {:else}
      <div class="trio">
        <div>
          <p class="label">Détenu</p>
          <p class="big"><Qty value={p.qty} abbreviate /></p>
          <p class="muted small">@ PRU {p.pru ? price(p.pru) : '—'}</p>
        </div>
        <div>
          <p class="label">Investi</p>
          <p class="big"><Money value={p.costBasis} compact /></p>
        </div>
        <div>
          <p class="label">Valeur</p>
          <p class="big"><Money value={p.value} compact /></p>
          {#if !p.closed || p.dust}<p class="small">
              <Money value={p.unrealized} sign colored /> (<Pct value={p.unrealizedPct} /> vs PRU)
              {p.dust ? 'latent résiduel' : 'latent'}
            </p>{/if}
        </div>
      </div>
      <p class="line">
        Réalisé <Money value={p.realized} sign colored /> ·
        <strong>Total <Money value={p.total} sign colored strong /></strong>
        · ROI <Pct value={p.roi} />
        <span class="muted small">sur <Money value={p.roiBase} /> engagés</span>
      </p>
      <p class="line muted small">
        Net investi {#if p.capitalRecovered}<strong>capital récupéré</strong> (<Money
            value={p.netInvested}
            sign
          />){:else}<Money value={p.netInvested} />{/if} · Frais <Money
          value={p.feesEur}
        />{#if p.rebatesEur.gt('0')}&nbsp;(remises <Money value={p.rebatesEur} />){/if}
      </p>
      {#if p.status === 'needs-qualification'}<p class="warn small">
          Des opérations de cet actif sont à qualifier : le calcul est incomplet.
        </p>{/if}
      {#if p.integrity && p.integrity.status !== 'ok'}<p class="warn small">
          {p.integrity.message}
        </p>{/if}
    {/if}
  </header>

  <EvolutionCard scope={asset} title="Évolution" />

  <p class="tools">
    {#if !p.closed && !p.blocked}
      <button class="link" type="button" onclick={() => (alertSheet = true)}
        >Créer une alerte</button
      >
      <button class="link" type="button" onclick={() => (simulateSheet = true)}>Simuler</button>
      {#if assetAlertCount > 0}
        <a class="link" href={router.href({ name: 'alerts' })}
          >{assetAlertCount} alerte{assetAlertCount > 1 ? 's' : ''}</a
        >
      {/if}
    {/if}
    <button
      class="link"
      type="button"
      onclick={() =>
        downloadText(
          `cout-revient-ch-${asset}-operations-${localDay(nowMs())}.csv`,
          operationsToCsv(app.report, app.currency, asset, app.accountLabels),
          'text/csv;charset=utf-8',
        )}>Télécharger l'historique de {asset.toUpperCase()} (CSV)</button
    >
  </p>
  <nav class="tabs" aria-label="Sections">
    <button type="button" class:active={tab === 'history'} onclick={() => (tab = 'history')}
      >Historique ({p.history.length})</button
    >
    <button type="button" class:active={tab === 'lots'} onclick={() => (tab = 'lots')}
      >Positions ({p.lots.length})</button
    >
    <button type="button" class:active={tab === 'calc'} onclick={() => (tab = 'calc')}
      >Calcul</button
    >
  </nav>

  {#if tab === 'history'}<HistoryTab position={p} />{:else if tab === 'lots'}<LotsTab
      position={p}
    />{:else}<CalcTab position={p} />{/if}

  <AlertRuleSheet bind:open={alertSheet} {asset} />
  <SimulateSheet bind:open={simulateSheet} {asset} />

  <Sheet bind:open={priceSheet} title="Prix manuel pour {asset.toUpperCase()}">
    <p>
      Utilisé à la place des cotations automatiques (par exemple pour un actif non coté ou hors
      ligne). Laissez vide pour revenir au prix automatique.
    </p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        saveManualPrice();
      }}
    >
      <input
        type="text"
        inputmode="decimal"
        placeholder="Prix en euros, ex. 65000"
        bind:value={manualPrice}
        aria-label="Prix en euros"
      />
      <button class="primary" type="submit">Enregistrer</button>
    </form>
  </Sheet>
{/if}

<style>
  .empty {
    padding: var(--space-5) var(--space-4);
    text-align: center;
  }
  .hero {
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-bottom: 1px solid var(--border);
    display: grid;
    gap: var(--space-3);
  }
  .title {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .price {
    font-size: var(--fs-lg);
    font-weight: 650;
  }
  .small {
    font-size: var(--fs-xs);
    font-weight: 400;
  }
  .link {
    color: var(--accent);
    font-size: var(--fs-xs);
    margin-left: var(--space-2);
    text-decoration: underline;
  }
  .trio {
    display: grid;
    /* Sur téléphone : Détenu et Investi côte à côte, Valeur seule sur une deuxième ligne. Trois
       colonnes serrées débordaient avec les polices larges (Linux, Android) et faisaient dézoomer
       la page. */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .trio > div {
    min-width: 0;
  }
  .trio > div:last-child {
    grid-column: 1 / -1;
  }
  @media (min-width: 768px) {
    .trio {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .trio > div:last-child {
      grid-column: auto;
    }
  }
  .label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .big {
    font-size: var(--fs-lg);
    font-weight: 650;
  }
  .line {
    font-size: var(--fs-sm);
  }
  .warn {
    color: var(--warn);
  }
  .tools {
    padding: var(--space-2) var(--space-4);
    font-size: var(--fs-sm);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }
  /* Cibles tactiles ≥ 24 px (WCAG 2.2 AA, target-size) : les liens-outils se replient sur
     mobile — sans hauteur minimale ni espacement, axe échoue (vu en CI Linux, pas sous Windows). */
  .tools .link {
    margin-left: 0;
    min-height: 24px;
    display: inline-flex;
    align-items: center;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 5;
  }
  .tabs button {
    min-width: 0;
    min-height: var(--tap);
    color: var(--fg-muted);
    border-bottom: 2px solid transparent;
    font-weight: 600;
  }
  .tabs button.active {
    color: var(--fg);
    border-bottom-color: var(--accent);
  }
  form {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  input {
    flex: 1;
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 0 var(--space-3);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-4);
    font-weight: 700;
    min-height: var(--tap);
  }
</style>
