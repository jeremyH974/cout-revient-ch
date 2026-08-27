<script lang="ts">
  /**
   * **Une variance, une forme** (décision n° 52). Partout où l'app montre un écart — variation de
   * période, gain depuis l'origine, part gagnée ou perdue par un espace — elle passe par ce
   * composant et par lui seul.
   *
   * C'est la règle de *notation sémantique* de l'ISO 24896:2026 / IBCS : ce qui a le même sens doit
   * avoir la même apparence, et ce qui n'a pas le même sens ne doit jamais se ressembler. La règle
   * a une conséquence directe et visible : un **niveau** (un solde, une valeur) reste neutre, seule
   * une **variance** est colorée. Sans cette discipline, un écran où tout est coloré ne dit plus
   * rien — c'était le défaut de la Vue d'ensemble avant cette refonte, avec neuf nombres rouges
   * d'égale importance.
   *
   * Le signe n'est **jamais porté par la seule couleur** : un triangle et le signe du nombre le
   * disent aussi, et un équivalent textuel complet part au lecteur d'écran (WCAG 2.2 AA — la
   * confusion rouge/vert est le défaut d'accessibilité le plus courant des graphiques financiers).
   */
  import type { Big } from '$lib/domain/money';
  import { fmtMasked, fmtMoney, fmtPct, roundsToZero } from '$lib/format/fr';
  import { app } from '../../state/app.svelte';

  let {
    value,
    pct = null,
    suffix = '',
    size = 'md',
  }: {
    /** Montant de la variance dans la devise d'affichage ; `null` quand elle n'est pas calculable. */
    value: Big | null;
    /** Variation relative associée (ratio : 0,1 = +10 %) ; omise si elle n'a pas de base saine. */
    pct?: Big | null;
    /** Contexte de lecture, par exemple « sur 1 mois » — jamais deviné, toujours fourni. */
    suffix?: string;
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  // Le ton se décide sur la valeur ARRONDIE : « 0,00 € » n'est ni un gain ni une perte, et le
  // marquer d'un triangle vert pour trois millièmes d'euro serait un mensonge de présentation.
  const tone = $derived(
    value === null || roundsToZero(value) ? 'flat' : value.lt('0') ? 'loss' : 'gain',
  );
  const MARK = { gain: '▲', loss: '▼', flat: '=' } as const;
  const SPOKEN = { gain: 'en hausse de', loss: 'en baisse de', flat: 'stable,' } as const;

  const amount = $derived(
    value === null
      ? '—'
      : app.state.ui.discreet
        ? fmtMasked(app.currency)
        : fmtMoney(value, app.currency, { sign: true, compact: true }),
  );
  const relative = $derived(pct === null ? '' : fmtPct(pct, { sign: true }));
</script>

<span class="delta {tone} {size}">
  <span class="mark" aria-hidden="true">{MARK[tone]}</span>
  <span class="sr-only">{SPOKEN[tone]}</span>
  <span class="num">{amount}</span>
  {#if relative}<span class="num rel">({relative})</span>{/if}
  {#if suffix}<span class="suffix">{suffix}</span>{/if}
</span>

<style>
  .delta {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    white-space: nowrap;
  }
  .gain {
    color: var(--gain);
  }
  .loss {
    color: var(--loss);
  }
  .flat {
    color: var(--fg-muted);
  }
  .mark {
    font-size: 0.75em;
    line-height: 1;
  }
  .sm {
    font-size: var(--fs-xs);
  }
  .md {
    font-size: var(--fs-sm);
  }
  .lg {
    font-size: var(--fs-md);
  }
  /* Le relatif et le contexte accompagnent le montant sans lui disputer l'attention. */
  .rel {
    font-weight: 500;
    opacity: 0.85;
  }
  .suffix {
    color: var(--fg-muted);
    font-weight: 400;
    font-size: 0.9em;
  }
</style>
