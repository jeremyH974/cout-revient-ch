<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtDate, fmtMoney } from '$lib/format/fr';
  import { periodWindow, sliceSeries, todayOf, type Period } from '$lib/history';
  import {
    estimatedShare,
    hasUnavailable,
    latestNetWorth,
    type NetWorthPoint,
  } from '$lib/history/net-worth';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import Info from '../shared/Info.svelte';
  import EvolutionChart, { type ChartPoint } from './EvolutionChart.svelte';

  /**
   * La période vient du tableau de bord et n'est plus choisie ici : un seul contexte de temps
   * pour tout l'écran, sinon le chiffre du bandeau et la courbe parlent de deux fenêtres
   * différentes sans que rien ne le signale (règle « unify » de l'ISO 24896:2026).
   */
  let { period }: { period: Period } = $props();
  onMount(() => void history.ensure());

  const today = $derived(todayOf(nowMs()));
  // La série est calculée une fois dans l'état d'historique : le bandeau, la réconciliation et
  // cette courbe lisent le MÊME objet, donc aucun des trois ne peut diverger des deux autres.
  const series = $derived<NetWorthPoint[]>(history.netWorth);
  const window = $derived(periodWindow(period, today));
  const visible = $derived(
    sliceSeries(series, { from: window.from ?? series[0]?.day ?? today, to: window.to }),
  );

  /**
   * Part portée au coût, jour par jour, arrondie une seule fois — la trame ET le texte la lisent
   * ici, et ne peuvent donc pas se contredire à l'arrondi près. Une part inférieure au millionième
   * retombe à zéro : elle ne se dessine ni ne s'annonce, parce qu'elle ne change rien.
   */
  const shares = $derived(visible.map((p) => Number(estimatedShare(p).toFixed(6))));

  /**
   * Courbe principale : la valeur nette. Courbe secondaire : les apports nets cumulés. L'écart
   * entre les deux EST le gain — c'est ce qui distingue cette courbe d'un solde de compte, où un
   * virement ressemble à une performance.
   */
  const points = $derived<ChartPoint[]>(
    visible.map((p, i) => ({
      day: p.day,
      primary: Number(p.net.toFixed(2)),
      secondary: Number(p.contributed.toFixed(2)),
      // La PART portée au coût, et non plus le seul fait qu'il y en ait une : un jeton marginal
      // sans cours ne doit plus effacer le gain et la perte de toute la journée (décision n° 114).
      estimated: shares[i] ?? 0,
    })),
  );

  const latest = $derived(latestNetWorth(visible));
  const incomplete = $derived(hasUnavailable(visible));
  const tradingCount = $derived(history.netWorthContributions.length - 1);
  /**
   * Actifs qui privent CETTE courbe de cotation, sur la fenêtre affichée. Rien ne les nommait ici,
   * et la trame restait donc une énigme : on voyait que quelque chose manquait, jamais quoi ni où
   * aller le corriger (décision n° 114).
   *
   * La liste vient de la série elle-même, et non du chargeur de prix : `history.status` ignore la
   * fenêtre affichée et couvre aussi les symboles de trading, qui ne sont pas des producteurs de
   * cette courbe.
   *
   * Et seuls les jours **hachurés** comptent, au même seuil : un actif dont la part est
   * imperceptible ne déplace pas la courbe, et le nommer sous un dessin où rien n'est marqué ne
   * fait qu'inquiéter sans rien apprendre — le cas s'est présenté tel quel sur le jeu de
   * démonstration. C'est ce partage de seuil qui interdit au texte et à la trame de diverger.
   */
  const guilty = $derived.by((): string[] => {
    const out: string[] = [];
    visible.forEach((p, i) => {
      if ((shares[i] ?? 0) <= 0) return;
      for (const a of p.estimatedAssets) if (!out.includes(a)) out.push(a);
    });
    return out.sort();
  });
  /** Aucun historique du tout, contre un historique qui commence trop tard : deux remèdes. */
  const noQuote = $derived(guilty.filter((a) => history.status.missing.includes(a)));
  const shortQuote = $derived(guilty.filter((a) => !history.status.missing.includes(a)));
  const upper = (list: readonly string[]): string => list.map((a) => a.toUpperCase()).join(', ');
</script>

<section class="card group" aria-labelledby="net-worth-title">
  <header>
    <h2 id="net-worth-title">Évolution du patrimoine</h2>
    <Info title="Évolution du patrimoine"
      >Ce que vous possédez, jour après jour, investissement et trading réunis. La courbe claire est
      le total de vos apports — l'argent entré dans le périmètre, jamais le coût de vos positions :
      l'écart entre les deux est votre résultat. Un virement déplace les deux courbes ensemble et ne
      ressemble donc jamais à une performance.</Info
    >
  </header>

  {#if points.length === 0}
    <p class="empty">Importez un export ou synchronisez un compte pour voir votre patrimoine.</p>
  {:else}
    <EvolutionChart
      {points}
      currency={app.currency}
      discreet={app.state.ui.discreet}
      colorMode="vsSecondary"
      labels={{ primary: 'Patrimoine', secondary: 'Apports nets' }}
    />
    {#if latest}
      <!--
        Équivalent textuel du graphique : un tracé SVG seul n'est lisible par personne au lecteur
        d'écran. C'est aussi l'ancrage du contrôle de cohérence — ce montant doit égaler, au
        centime, le « Patrimoine » du bandeau ci-dessus.
      -->
      <p class="summary" data-testid="net-worth-latest">
        Au {fmtDate(latest.day)}, patrimoine
        <strong data-testid="net-worth-latest-value">{fmtMoney(latest.net, app.currency)}</strong>,
        pour <strong>{fmtMoney(latest.contributed, app.currency)}</strong> d'apports nets.
      </p>
    {/if}
    <p class="legend">
      {#if tradingCount > 0}
        Investissement + {tradingCount} compte{tradingCount > 1 ? 's' : ''} de trading. L'équité de trading
        est ramenée à un point par jour : la courbe de l'écran Trading, non amincie, reste la référence
        pour lire un épisode violent.
      {:else}
        Espace Investissement seul — aucun compte de trading synchronisé.
      {/if}
    </p>
    {#if noQuote.length > 0 || shortQuote.length > 0}
      <p class="legend" data-testid="net-worth-quotes">
        {#if noQuote.length > 0}
          <strong>Sans cotation :</strong>
          {upper(noQuote)} — la position est comptée à son coût. Désignez sa source depuis sa fiche pour
          que la courbe la valorise.
        {/if}
        {#if shortQuote.length > 0}
          <strong>Historique partiel :</strong>
          {upper(shortQuote)} — coté seulement à partir d'une certaine date, au coût avant elle.
        {/if}
      </p>
    {/if}
    {#if incomplete}
      <p class="warn" role="status">
        Certains jours sont <strong>incomplets</strong> : un compte n'a pas pu être converti en euros
        faute de taux de change. Le total affiché est donc trop bas sur ces jours-là, et non approché.
        Actualisez les taux depuis les réglages.
      </p>
    {/if}
  {/if}
</section>

<style>
  .group {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .summary {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .empty,
  .legend {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .warn {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
    border-left: 3px solid var(--warn, var(--border));
    padding-left: var(--space-3);
  }
</style>
