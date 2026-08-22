<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';
  import { fmtDate, fmtEur, fmtPct, fmtPrice, fmtQty } from '$lib/format/fr';

  let { position }: { position: PositionReport } = $props();
  const p = $derived(position);
  const sells = $derived(p.history.filter((h) => h.realized !== null).reverse());
</script>

<div class="calc">
  {#if p.closed}
    <section>
      <h3>Position clôturée</h3>
      <p>Plus aucune unité détenue : seul le réalisé compte.</p>
    </section>
  {:else}
    <section>
      <h3>PRU (prix de revient unitaire)</h3>
      <p>
        Coût total des unités détenues ÷ quantité détenue, <strong>spread et frais inclus</strong>.
        Il change uniquement quand vous achetez, jamais quand vous vendez.
      </p>
      <p class="formula">
        {fmtEur(p.costBasis)} ÷ {fmtQty(p.qty)} = <strong>{p.pru ? fmtPrice(p.pru) : '—'}</strong>
      </p>
    </section>
    <section>
      <h3>Latent</h3>
      <p>
        Ce que vous gagneriez ou perdriez en vendant tout maintenant : quantité × (prix actuel −
        PRU).
      </p>
      <p class="formula">
        {fmtQty(p.qty)} × ({p.price ? fmtPrice(p.price.priceEur) : '—'} − {p.pru
          ? fmtPrice(p.pru)
          : '—'}) = <strong>{fmtEur(p.unrealized, { sign: true })}</strong> ({fmtPct(
          p.unrealizedPct,
        )} vs PRU)
      </p>
    </section>
  {/if}
  <section>
    <h3>Réalisé</h3>
    <p>
      Pour chaque vente : produit net de la vente − quantité vendue × PRU au moment de la vente.
    </p>
    {#if sells.length === 0}
      <p class="formula">Aucune vente.</p>
    {:else}
      <ul>
        {#each sells as h (h.eventId + h.kind)}
          <li>
            {fmtDate(h.at)} : {fmtEur(h.valueEur)} − {fmtQty(h.qty.abs())} × PRU =
            <strong>{fmtEur(h.realized, { sign: true })}</strong>
          </li>
        {/each}
      </ul>
      <p class="formula">Total réalisé = <strong>{fmtEur(p.realized, { sign: true })}</strong></p>
    {/if}
  </section>
  <section>
    <h3>Total et ROI</h3>
    <p class="formula">
      Total = réalisé + latent{#if p.otherIncome.gt('0')}
        + récompenses{/if} = {fmtEur(p.realized, { sign: true })}
      {fmtEur(p.unrealized, { sign: true })}{#if p.otherIncome.gt('0')}
        {fmtEur(p.otherIncome, { sign: true })}{/if} =
      <strong>{fmtEur(p.total, { sign: true })}</strong>
    </p>
    <p class="formula">
      ROI = total ÷ tout ce que vous avez acheté = {fmtEur(p.total, { sign: true })} ÷ {fmtEur(
        p.investedTotal,
      )} = <strong>{fmtPct(p.roi)}</strong>
    </p>
  </section>
  <section>
    <h3>Net investi</h3>
    <p>
      Somme des achats − somme des ventes : l'argent encore engagé sur cet actif.{#if p.capitalRecovered}
        <strong>Capital récupéré</strong> : vous avez déjà retiré plus que vous n'avez mis ; aucun pourcentage
        n'est calculé sur cette base.{/if}
    </p>
    <p class="formula">
      {fmtEur(p.investedTotal)} − {fmtEur(p.proceedsTotal)} =
      <strong>{fmtEur(p.netInvested)}</strong>
    </p>
  </section>
  <section>
    <h3>Frais</h3>
    <p class="formula">
      Frais Coinhouse payés sur cet actif : {fmtEur(p.feesEur)}{#if p.rebatesEur.gt('0')}
        (dont remises obtenues : {fmtEur(p.rebatesEur)}){/if}. Le spread est déjà dans les prix
      all-in.
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
