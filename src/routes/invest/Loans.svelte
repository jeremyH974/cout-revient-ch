<script lang="ts">
  /**
   * Écran Prêts. Deux règles de présentation gouvernent tout le reste :
   *
   * 1. **Le bandeau ne porte que deux chiffres** — ce qui a été apporté, ce que ça vaut. Le
   *    capital prêté cumulé est relégué dans le bloc explicatif : affiché en haut, il se lirait
   *    comme un investissement alors que c'est le même argent recyclé, et il diviserait le
   *    rendement perçu par le facteur de recyclage.
   * 2. **Un niveau reste neutre, seule une variance est colorée** (décision n° 56). Apports et
   *    valeur passent par `Money`, le gain par `Delta` — qui porte déjà signe, triangle et
   *    équivalent parlé, jamais la couleur seule.
   *
   * Les seuils de concentration sont ceux du DOJ transposés à l'indice de Herfindahl-Hirschman
   * (< 1 500 dispersé, 1 500–2 500 modéré, > 2 500 fort, sur l'échelle 0–10 000). Faute de règle
   * de place française — le référentiel de Financement Participatif France n'en donne aucune —
   * c'est plus défendable qu'un seuil inventé.
   */
  import { D } from '$lib/domain/money';
  import { fmtPct, fmtRatio } from '$lib/format/fr';
  import type { LoanStatus } from '$lib/domain/lending/types';
  import { TAX_BOXES } from '$lib/domain/lending/tax-fr';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Delta from '../../components/shared/Delta.svelte';
  import Money from '../../components/shared/Money.svelte';
  import Pct from '../../components/shared/Pct.svelte';
  import { router } from '$lib/router.svelte';
  import { app } from '../../state/app.svelte';

  const s = $derived(app.lending);
  const report = $derived(app.lendingReport);
  const perf = $derived(app.lendingPerf);
  const tax = $derived(app.lendingTax);

  const STATUS: Record<LoanStatus, string> = {
    pending: 'En attente',
    performing: 'En cours',
    late: 'En retard',
    defaulted: 'En défaut',
    'written-off': 'Perte constatée',
    sold: 'Cédé',
    repaid: 'Remboursé',
  };
  const LIVE: LoanStatus[] = ['pending', 'performing', 'late', 'defaulted'];

  const XIRR_REASON: Record<string, string> = {
    'insufficient-flows': 'pas assez de flux',
    'same-sign': 'aucun remboursement encore',
    'too-recent': 'moins de 30 jours d’historique',
    'no-convergence': 'non calculable',
  };

  let showClosed = $state(false);
  const rows = $derived(
    report.loans
      .filter((l) => showClosed || LIVE.includes(l.status))
      .slice()
      .sort((a, b) => D(b.outstanding).cmp(D(a.outstanding))),
  );

  /** Indice ramené à l'échelle 0–10 000 des autorités de concurrence. */
  const hhi = $derived(
    report.concentration.byBorrower.index === null
      ? null
      : D(report.concentration.byBorrower.index).times('10000'),
  );
  const spread = $derived(
    hhi === null
      ? { mark: '', label: 'Non mesurable' }
      : hhi.lt('1500')
        ? { mark: '●', label: 'Dispersé' }
        : hhi.lt('2500')
          ? { mark: '◐', label: 'Modérément concentré' }
          : { mark: '○', label: 'Fortement concentré' },
  );
  // Formatage français : virgule décimale et espace insécable, comme partout ailleurs dans l'app.
  const effectiveRaw = $derived(report.concentration.byBorrower.effectiveCount);
  const effective = $derived(effectiveRaw === null ? null : fmtRatio(D(effectiveRaw), 1));
  const effectivePlural = $derived(effectiveRaw !== null && D(effectiveRaw).gte('2') ? 's' : '');
</script>

<AppBar title="Prêts" back />

<main>
  {#if !app.hasLending}
    <section class="card empty">
      <h2>Aucun prêt importé</h2>
      <p>
        Cet écran suit vos prêts de financement participatif : ce que vous avez apporté, ce qu'il
        reste dû, et ce que cela rapporte réellement.
      </p>
      <p class="muted">
        Depuis votre espace BienPrêter, ouvrez <strong>Opérations</strong> et exportez l'historique
        <strong>sans filtre</strong> — un export filtré ne contient que les dépôts. N'ouvrez pas le fichier
        dans Excel avant de l'importer.
      </p>
      <button type="button" onclick={() => router.navigate({ name: 'import' })}>
        Importer un export
      </button>
    </section>
  {:else}
    <section class="card headline">
      <div class="figure">
        <span class="label">Apports nets</span>
        <Money value={app.displayFromEur(s.netContributions)} strong />
        <span class="hint">ce que vous avez déposé, retraits déduits</span>
      </div>
      <div class="figure">
        <span class="label">Valeur du portefeuille</span>
        <Money value={app.displayFromEur(s.value)} strong />
        <span class="hint">capital restant dû + trésorerie disponible</span>
      </div>
    </section>

    <section class="card perf">
      <div class="line">
        <span class="label">Gain cumulé</span>
        <Delta
          value={app.displayFromEur(s.result)}
          pct={s.returnOnContributions === null ? null : D(s.returnOnContributions)}
          suffix="depuis le début"
          size="lg"
        />
      </div>
      <div class="line rates">
        <span>
          <span class="label">TRI net</span>
          {#if perf.net.ok}
            <strong><Pct value={perf.net.rate} colored={false} /> par an</strong>
          {:else}
            <span class="muted">{XIRR_REASON[perf.net.reason] ?? '—'}</span>
          {/if}
        </span>
        <span class="muted">
          TRI brut
          {#if perf.gross.ok}<Pct value={perf.gross.rate} colored={false} />{:else}—{/if}
        </span>
      </div>
      <p class="muted small">
        Le TRI net est calculé après les prélèvements retenus à la source. Il est annualisé ; le
        gain cumulé, lui, couvre toute la période.
      </p>
    </section>

    <details class="card">
      <summary>Comment lire ces chiffres</summary>
      <p>
        Vous avez prêté <strong><Money value={app.displayFromEur(s.principalLent)} /></strong> au
        total, soit
        <strong>{s.recycling === null ? '—' : fmtRatio(D(s.recycling), 2)} fois</strong> vos apports
        : chaque remboursement est reprêté.
        <strong>Ce n'est pas de l'argent supplémentaire</strong>, et c'est pourquoi le gain est
        rapporté aux apports, jamais au capital prêté.
      </p>
      <dl>
        <div>
          <dt>Intérêts bruts encaissés</dt>
          <dd><Money value={app.displayFromEur(s.interestGross)} /></dd>
        </div>
        <div>
          <dt>Prélèvements retenus à la source</dt>
          <dd><Money value={app.displayFromEur(s.withheld)} /></dd>
        </div>
        <div>
          <dt>Intérêts nets</dt>
          <dd><Money value={app.displayFromEur(s.interestNet)} /></dd>
        </div>
        <div>
          <dt>Bonus de la plateforme</dt>
          <dd><Money value={app.displayFromEur(s.bonus)} /></dd>
        </div>
        <div>
          <dt>Capital passé en perte</dt>
          <dd><Money value={app.displayFromEur(s.writtenOff)} /></dd>
        </div>
        <div>
          <dt>Trésorerie non prêtée</dt>
          <dd><Money value={app.displayFromEur(s.cash)} /></dd>
        </div>
      </dl>
      {#if report.totals.accrualUnavailable > 0}
        <p class="muted small">
          Les intérêts courus non échus ne sont pas comptés sur {report.totals.accrualUnavailable} prêt{report
            .totals.accrualUnavailable > 1
            ? 's'
            : ''} : l'export ne porte ni taux ni convention de jours. La valeur est donc légèrement sous-estimée,
          jamais inventée.
        </p>
      {/if}
    </details>

    <section class="card">
      <h2>Répartition du risque</h2>
      <p class="spread">
        <span aria-hidden="true">{spread.mark}</span>
        <strong>{spread.label}</strong>
        {#if effective}
          · <strong>{effective}</strong> emprunteur{effectivePlural} effectif{effectivePlural} sur
          {report.concentration.byBorrower.top.length} en cours
        {/if}
      </p>
      <p class="muted small">
        « Emprunteurs effectifs » = le nombre de lignes de poids égal qui donnerait la même
        concentration. Un portefeuille de 50 prêts dont un pèse la moitié se comporte comme un
        portefeuille bien plus étroit.
      </p>
      {#if report.concentration.byBorrower.top.length > 0}
        <ul class="top">
          {#each report.concentration.byBorrower.top.slice(0, 5) as row (row.key)}
            <li>
              <span class="who">{row.key}</span>
              <Money value={app.displayFromEur(row.outstanding)} />
              <span class="muted">({fmtPct(D(row.weight), { sign: false })})</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if tax.years.length > 0}
      <details class="card">
        <summary>Déclaration de revenus — estimation</summary>
        <p class="muted small">
          Estimation calculée à partir de vos seules opérations. Ce n'est ni une déclaration, ni un
          conseil fiscal. Vérifiez chaque montant sur l'IFU que la plateforme vous remet en début
          d'année.
        </p>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Année</th>
                <th scope="col" class="right">Intérêts — {TAX_BOXES.interest.box}</th>
                <th scope="col" class="right">Acompte — {TAX_BOXES.incomeTaxCredit.box}</th>
                <th scope="col" class="right">Sociaux — {TAX_BOXES.social.box}</th>
                <th scope="col" class="right">Perte imputée</th>
                <th scope="col" class="right">À reporter — {TAX_BOXES.carry.box}</th>
              </tr>
            </thead>
            <tbody>
              {#each tax.years as y (y.year)}
                <tr>
                  <th scope="row">{y.year}<span class="muted small block">{y.rate.label}</span></th>
                  <td class="right"><Money value={app.displayFromEur(y.interestGross)} /></td>
                  <td class="right"><Money value={app.displayFromEur(y.incomeTaxCredit)} /></td>
                  <td class="right"><Money value={app.displayFromEur(y.socialPaid)} /></td>
                  <td class="right"><Money value={app.displayFromEur(y.lossImputed)} /></td>
                  <td class="right">
                    <Money
                      value={app.displayFromEur(
                        y.carryForward.reduce((t, c) => t.plus(D(c.amount)), D('0')),
                      )}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="muted small">
          Les intérêts de prêts participatifs se déclarent case <strong>2TT</strong>, et non 2TR —
          la brochure officielle le dit expressément. La plateforme ne communique qu'un montant
          retenu global : le partage entre acompte de 12,8 % et prélèvements sociaux est
          <strong>déduit du taux effectivement retenu</strong>. Une année où seuls les prélèvements
          sociaux apparaissent signale une dispense d'acompte — elle se redemande chaque année,
          avant le 30 novembre.
        </p>
        {#if tax.hasLosses}
          <p class="warn">
            Ce tableau impute des pertes en capital. Le texte laisse plusieurs points ouverts, que
            l'application tranche par convention :
          </p>
          <ul class="muted small">
            {#each tax.assumptions as note (note)}<li>{note}</li>{/each}
          </ul>
          <p class="muted small">Faites vérifier par un professionnel avant de déclarer.</p>
        {/if}
      </details>
    {/if}

    <section class="card">
      <div class="head">
        <h2>Prêts ({rows.length})</h2>
        <label>
          <input type="checkbox" bind:checked={showClosed} />
          Afficher les prêts soldés
        </label>
      </div>
      <div class="scroll">
        <table>
          <caption class="sr-only">Prêts triés par capital restant dû décroissant</caption>
          <thead>
            <tr>
              <th scope="col">Emprunteur</th>
              <th scope="col">Statut</th>
              <th scope="col" class="right">Capital restant dû</th>
              <th scope="col" class="right">Intérêts nets</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.loan.id)}
              <tr>
                <th scope="row">
                  {row.loan.borrower}
                  <span class="muted small block">{row.loan.label}</span>
                </th>
                <td>
                  {STATUS[row.status]}
                  {#if row.daysLate !== null}
                    <span class="muted small">({row.daysLate} j)</span>
                  {/if}
                </td>
                <td class="right"><Money value={app.displayFromEur(row.outstanding)} /></td>
                <td class="right">
                  <Money
                    value={app.displayFromEur(D(row.interestReceived).minus(D(row.withheld)))}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <p class="muted small note">
      Chiffres calculés à partir de vos propres opérations. Les performances passées ne préjugent
      pas des performances futures.
    </p>
  {/if}
</main>

<style>
  main {
    display: grid;
    gap: 1rem;
  }
  .headline {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 30rem) {
    .headline {
      grid-template-columns: 1fr;
    }
  }
  .figure {
    display: grid;
    gap: 0.15rem;
    font-size: 1.35rem;
  }
  .label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }
  .hint,
  .small {
    font-size: 0.8rem;
  }
  .perf .line {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .perf .rates {
    margin-top: 0.4rem;
    gap: 1.2rem;
  }
  dl {
    display: grid;
    gap: 0.3rem;
    margin: 0.6rem 0 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  dt {
    opacity: 0.8;
  }
  dd {
    margin: 0;
  }
  .spread {
    font-size: 1.05rem;
  }
  .top {
    list-style: none;
    padding: 0;
    margin: 0.6rem 0 0;
    display: grid;
    gap: 0.3rem;
  }
  .top li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
  }
  .who {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .head label {
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    vertical-align: top;
  }
  th[scope='row'] {
    font-weight: 500;
  }
  .right {
    text-align: right;
  }
  .block {
    display: block;
  }
  .note {
    margin: 0;
  }
</style>
