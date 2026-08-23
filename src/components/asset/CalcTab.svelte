<script lang="ts">
  import type { HistoryEntry, PositionReport } from '$lib/domain/engine';
  import type { Big } from '$lib/domain/money';
  import { MASK, fmtDate, fmtMasked, fmtMoney, fmtPct, fmtQty } from '$lib/format/fr';
  import { fmtPrice as fmtPriceBase } from '$lib/format/fr';
  import { app } from '../../state/app.svelte';

  let { position }: { position: PositionReport } = $props();
  const p = $derived(position);
  const discreet = $derived(app.state.ui.discreet);
  // Mode discret : montants et quantités masqués ; les prix (PRU, cours) restent lisibles.
  const eur = (v: Big | null, opts?: { sign?: boolean }): string =>
    v === null ? '—' : discreet ? fmtMasked(app.currency) : fmtMoney(v, app.currency, opts);
  const qty = (v: Big | null): string => (v === null ? '—' : discreet ? MASK : fmtQty(v));
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);
  const kinds: Record<string, string> = {
    sell: 'vente',
    withdrawal: 'retrait',
    'migration-out': 'migration',
  };
  /** PRU retenu pour une cession : (produit − réalisé) ÷ quantité cédée. */
  const pruAt = (h: HistoryEntry): Big | null =>
    h.valueEur !== null && h.realized !== null && h.qty.abs().gt('0')
      ? h.valueEur.minus(h.realized).div(h.qty.abs())
      : null;
  const disposals = $derived(p.history.filter((h) => h.realized !== null).reverse());
</script>

<div class="calc">
  {#if p.closed}
    <section>
      <h3>
        Position clôturée{#if p.dust}&nbsp;(résidu){/if}
      </h3>
      {#if p.dust}
        <p>
          Il reste {qty(p.qty)}
          {p.asset.toUpperCase()}, soit moins de 0,01 € : la position est classée clôturée, mais ce
          résidu reste valorisé et son latent compte dans le total.
        </p>
        <p class="formula">
          Latent résiduel = {eur(p.value)} − {eur(p.costBasis)} =
          <strong>{eur(p.unrealized, { sign: true })}</strong>
        </p>
      {:else}
        <p>
          Plus aucune unité détenue : le total se limite au réalisé{#if p.otherIncome.gt('0')}
            et aux récompenses valorisées{/if}.
        </p>
      {/if}
    </section>
  {:else}
    <section>
      <h3>PRU (prix de revient unitaire)</h3>
      <p>
        Coût total des unités détenues ÷ quantité détenue, <strong>spread et frais inclus</strong>.
        Il change uniquement quand vous achetez, jamais quand vous vendez.
      </p>
      <p class="formula">
        {eur(p.costBasis)} ÷ {qty(p.qty)} = <strong>{p.pru ? price(p.pru) : '—'}</strong>
      </p>
    </section>
    <section>
      <h3>Latent</h3>
      <p>
        Ce que vous gagneriez ou perdriez en vendant tout maintenant : quantité × (prix actuel −
        PRU). Le pourcentage rapporte ce latent à l'investi (quantité × PRU) : c'est l'écart du prix
        au PRU.
      </p>
      <p class="formula">
        {qty(p.qty)} × ({p.price ? price(p.price.priceEur) : '—'} − {p.pru ? price(p.pru) : '—'}) =
        <strong>{eur(p.unrealized, { sign: true })}</strong>
        ({fmtPct(p.unrealizedPct)} vs PRU)
      </p>
    </section>
  {/if}
  <section>
    <h3>Réalisé</h3>
    <p>
      Pour chaque cession (vente, retrait, migration) : produit net − quantité cédée × PRU au moment
      de la cession.
    </p>
    {#if disposals.length === 0}
      <p class="formula">Aucune cession.</p>
    {:else}
      <ul>
        {#each disposals as h (h.eventId + h.kind)}
          <li>
            {fmtDate(h.at)} ({kinds[h.kind] ?? h.kind}) : {eur(h.valueEur)} − {qty(h.qty.abs())} ×
            {price(pruAt(h))} = <strong>{eur(h.realized, { sign: true })}</strong>
          </li>
        {/each}
      </ul>
      <p class="formula">Total réalisé = <strong>{eur(p.realized, { sign: true })}</strong></p>
    {/if}
  </section>
  <section>
    <h3>Total et ROI</h3>
    <p class="formula">
      Total = réalisé + latent{#if p.otherIncome.gt('0')}
        + récompenses{/if} = {eur(p.realized, { sign: true })}
      {eur(p.unrealized, { sign: true })}{#if p.otherIncome.gt('0')}
        {eur(p.otherIncome, { sign: true })}{/if} =
      <strong>{eur(p.total, { sign: true })}</strong>
    </p>
    <p>
      Le ROI rapporte ce total au <strong>capital maximal engagé</strong> sur cet actif : le plus d'euros
      que vous ayez eu investis en même temps (achats − produits, au plus haut). Vendre puis racheter
      n'augmente pas cette base.
    </p>
    <p class="formula">
      ROI = {eur(p.total, { sign: true })} ÷ {eur(p.roiBase)} engagés =
      <strong>{fmtPct(p.roi)}</strong>
    </p>
  </section>
  <section>
    <h3>Net investi</h3>
    <p>
      Somme des achats − somme des ventes : l'argent encore engagé sur cet actif.{#if p.capitalRecovered}
        <strong>Capital récupéré</strong> : vous avez déjà retiré au moins autant que vous n'avez mis
        ; aucun pourcentage n'est calculé sur cette base.{/if}
    </p>
    <p class="formula">
      {eur(p.investedTotal)} − {eur(p.proceedsTotal)} =
      <strong>{eur(p.netInvested)}</strong>
    </p>
  </section>
  <section>
    <h3>Frais</h3>
    <p class="formula">
      Frais Coinhouse payés sur cet actif : {eur(p.feesEur)}{#if p.rebatesEur.gt('0')}
        (dont remises obtenues : {eur(p.rebatesEur)}){/if}. Le spread est déjà dans les prix all-in.
    </p>
  </section>
  {#if p.integrity}
    <section>
      <h3>Contrôle de cohérence</h3>
      <p class:warn={p.integrity.status !== 'ok'}>
        {p.integrity.message}{#if p.integrity.reorderedDays.length > 0}
          Ordre de règlement différent de l'ordre des horodatages le {p.integrity.reorderedDays.join(
            ', ',
          )} (sans incidence).{/if}
      </p>
    </section>
  {/if}
</div>

<style>
  .calc {
    padding: var(--space-3) var(--space-4);
    display: grid;
    gap: var(--space-4);
    font-size: var(--fs-sm);
  }
  h3 {
    margin-bottom: var(--space-1);
  }
  .formula {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    margin-top: var(--space-1);
  }
  ul {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-4);
  }
  .warn {
    color: var(--warn);
  }
</style>
