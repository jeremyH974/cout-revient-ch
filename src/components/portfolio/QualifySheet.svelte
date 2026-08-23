<script lang="ts">
  /**
   * Qualification guidée d'une opération inconnue : choix cohérents avec les jambes (quantités
   * signées), montant facultatif ou requis selon le choix, proposition pré-sélectionnée d'après le
   * libellé Coinhouse (`row-types.ts`). Rien n'est appliqué sans « Enregistrer » ; la qualification
   * reste annulable depuis la liste « Qualifications enregistrées ».
   */
  import { D, isNegative, isPositive } from '$lib/domain/money';
  import type { Qualification, UnqualifiedEvent } from '$lib/domain/types';
  import { fmtDate } from '$lib/format/fr';
  import { rowTypeHint, suggestQualification } from '$lib/import/coinhouse/row-types';
  import Qty from '../shared/Qty.svelte';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let { open = $bindable(false), event }: { open?: boolean; event: UnqualifiedEvent | null } =
    $props();

  type Kind = Qualification['kind'];
  interface Choice {
    kind: Kind;
    label: string;
    note: string;
    amountLabel: string | null;
    amountRequired: boolean;
  }

  const CHOICES: Record<Kind, Choice> = {
    reward: {
      kind: 'reward',
      label: 'Récompense (staking, intérêts, parrainage)',
      note: 'Jetons reçus sans contrepartie : coût 0 € par défaut (réglage « Récompenses »).',
      amountLabel: 'Valeur en euros (facultatif)',
      amountRequired: false,
    },
    deposit: {
      kind: 'deposit',
      label: 'Dépôt depuis l’extérieur',
      note: 'Jetons transférés vers Coinhouse : leur coût d’acquisition, si vous le connaissez.',
      amountLabel: 'Valeur en euros (facultatif)',
      amountRequired: false,
    },
    purchase: {
      kind: 'purchase',
      label: 'Achat payé hors plateforme',
      note: 'Vous avez payé ces jetons ailleurs : le coût entre dans le PRU.',
      amountLabel: 'Coût en euros',
      amountRequired: true,
    },
    withdrawal: {
      kind: 'withdrawal',
      label: 'Retrait vers l’extérieur',
      note: 'Jetons envoyés hors de Coinhouse : vous les détenez toujours ailleurs.',
      amountLabel: 'Valeur en euros (facultatif)',
      amountRequired: false,
    },
    sale: {
      kind: 'sale',
      label: 'Vente encaissée hors plateforme',
      note: 'Le produit de la vente réalise une plus ou moins-value.',
      amountLabel: 'Produit en euros',
      amountRequired: true,
    },
    trade: {
      kind: 'trade',
      label: 'Échange',
      note: 'Une jambe sort, une jambe entre : indiquez la valeur en euros de l’opération.',
      amountLabel: 'Valeur de l’échange en euros',
      amountRequired: true,
    },
    ignore: {
      kind: 'ignore',
      label: 'Ignorer (mouvement interne)',
      note: 'Rien à compter : l’actif reste le vôtre (mise en staking, retour de staking…).',
      amountLabel: null,
      amountRequired: false,
    },
  };

  const choices = $derived.by((): Choice[] => {
    const legs = event?.legs ?? [];
    const positive = legs.filter((l) => isPositive(D(l.signedQty))).length;
    const negative = legs.filter((l) => isNegative(D(l.signedQty))).length;
    const kinds: Kind[] = [];
    if (legs.length === 1 && positive === 1) kinds.push('reward', 'deposit', 'purchase');
    if (legs.length === 1 && negative === 1) kinds.push('withdrawal', 'sale');
    if (legs.length === 2 && positive === 1 && negative === 1) kinds.push('trade');
    kinds.push('ignore');
    return kinds.map((k) => CHOICES[k]);
  });
  const suggestion = $derived(event ? suggestQualification(event.rawType, event.legs) : null);
  const hint = $derived(event ? rowTypeHint(event.rawType) : null);
  const lineNumbers = $derived(event ? app.lineNumbersOf(event.rowKeys) : []);

  let kind = $state<Kind>('ignore');
  let amount = $state('');
  let error = $state<string | null>(null);

  // À chaque ouverture : proposition pré-sélectionnée (ou premier choix), montant vide.
  $effect(() => {
    if (!open || !event) return;
    const wanted = suggestion?.kind;
    kind =
      wanted && choices.some((c) => c.kind === wanted) ? wanted : (choices[0]?.kind ?? 'ignore');
    amount = '';
    error = null;
  });

  const choice = $derived(CHOICES[kind]);

  /** « 12,5 » → '12.5' ; null si vide ; undefined si illisible. */
  function parseAmount(raw: string): string | null | undefined {
    const text = raw.trim().replace(/\s/g, '').replace(',', '.');
    if (text === '') return null;
    return /^\d+(\.\d+)?$/.test(text) ? text : undefined;
  }

  function save(): void {
    if (!event) return;
    const value = parseAmount(amount);
    if (value === undefined) {
      error = 'Montant illisible : chiffres et virgule uniquement, ex. 12,50.';
      return;
    }
    if (choice.amountRequired && value === null) {
      error = `${choice.amountLabel} : montant requis.`;
      return;
    }
    let q: Qualification;
    switch (kind) {
      case 'reward':
        q = { kind, fairValueEur: value };
        break;
      case 'deposit':
        q = { kind, costEur: value };
        break;
      case 'withdrawal':
        q = { kind, proceedsEur: value };
        break;
      case 'purchase':
        q = { kind, costEur: value! };
        break;
      case 'sale':
        q = { kind, proceedsEur: value! };
        break;
      case 'trade':
        q = { kind, valueEur: value! };
        break;
      default:
        q = { kind: 'ignore' };
    }
    app.qualify(event.id, q);
    open = false;
    toasts.push('Opération qualifiée : les chiffres sont recalculés.', 'success');
  }
</script>

<Sheet bind:open title="Qualifier l'opération">
  {#if event}
    <p class="summary">
      <strong>{fmtDate(event.at)}</strong> · {event.rawType}
      {#if lineNumbers.length > 0}<span class="muted small">
          · ligne{lineNumbers.length > 1 ? 's' : ''} {lineNumbers.join(', ')}</span
        >{/if}
    </p>
    <p class="legs">
      {#each event.legs as leg, i (leg.asset + i)}
        {#if i > 0}&nbsp;/
        {/if}<Qty value={D(leg.signedQty)} asset={leg.asset} sign />
      {/each}
    </p>
    {#if hint?.mode === 'suggest'}
      <p class="small muted">Libellé non confirmé par Coinhouse : proposition à vérifier.</p>
    {/if}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset>
        <legend>Que représente cette opération ?</legend>
        {#each choices as c (c.kind)}
          <label class="choice">
            <input
              type="radio"
              name="qualification"
              value={c.kind}
              aria-label={c.label}
              bind:group={kind}
            />
            <span
              ><span class="label">{c.label}</span><span class="muted small">{c.note}</span></span
            >
          </label>
        {/each}
      </fieldset>
      {#if choice.amountLabel}
        <label class="field"
          >{choice.amountLabel}
          <input
            type="text"
            inputmode="decimal"
            placeholder="ex. 12,50"
            bind:value={amount}
            aria-invalid={error ? 'true' : undefined}
          />
        </label>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" type="submit">Enregistrer</button>
    </form>
  {/if}
</Sheet>

<style>
  .summary {
    margin: 0 0 var(--space-1);
  }
  .legs {
    margin: 0 0 var(--space-3);
    font-variant-numeric: tabular-nums;
  }
  fieldset {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: 0;
    border: 0;
  }
  legend {
    font-weight: 600;
    margin-bottom: var(--space-2);
  }
  .choice {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2);
    align-items: start;
    min-height: var(--tap);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .choice:has(input:checked) {
    border-color: var(--accent);
  }
  .choice input {
    margin-top: 3px;
  }
  .choice > span {
    display: grid;
    gap: 2px;
  }
  .label {
    font-weight: 600;
  }
  .field {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
    font-weight: 600;
  }
  .error {
    color: var(--loss);
    margin: 0 0 var(--space-2);
  }
  .primary {
    width: 100%;
    min-height: 48px;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
  }
</style>
