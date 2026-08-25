<script lang="ts">
  import { untrack } from 'svelte';
  import {
    alertConditionMet,
    alertDistance,
    alertThresholdEur,
    type AlertDirection,
    type AlertRule,
    type AlertThresholdSpec,
  } from '$lib/domain/alerts';
  import { COINHOUSE_FEES } from '$lib/domain/fees';
  import { D, parseDecimal, type Big } from '$lib/domain/money';
  import { fmtPct, fmtPrice } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import Sheet from '../shared/Sheet.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let {
    open = $bindable(false),
    asset = '',
    rule = null,
  }: { open?: boolean; asset?: string; rule?: AlertRule | null } = $props();

  type FormKind = 'below-pct' | 'above-pct' | 'net-pct' | 'price';
  let formAsset = $state('');
  let kind = $state<FormKind>('below-pct');
  let percent = $state('10');
  let price = $state('');
  let priceDirection = $state<AlertDirection>('below');
  let feeKind = $state<'crypto-crypto' | 'sell-eur'>('crypto-crypto');
  let repeat = $state<'once' | 'recurring'>('recurring');
  let note = $state('');

  const heldAssets = $derived(
    [...new Set([...Object.keys(app.alertPositions), ...(formAsset ? [formAsset] : [])])].sort(),
  );
  const position = $derived(app.alertPositions[formAsset] ?? null);
  const spotEur = $derived.by((): string | null => {
    const quote = app.quotes[formAsset];
    return quote && !quote.stale ? quote.priceEur : null;
  });

  /**
   * À l'ouverture SEULEMENT : préremplir depuis la règle éditée, ou des défauts sains. Le corps
   * est `untrack`é — sinon l'effet dépendrait de valeurs dérivées des champs (le cours dépend de
   * l'actif choisi) et réinitialiserait le formulaire à chaque saisie.
   */
  let wasOpen = false;
  $effect(() => {
    const opening = open && !wasOpen;
    wasOpen = open;
    if (opening) untrack(initializeForm);
  });

  function initializeForm(): void {
    if (rule) {
      formAsset = rule.asset;
      repeat = rule.repeat;
      note = rule.note;
      const t = rule.threshold;
      if (t.kind === 'price') {
        kind = 'price';
        price = t.priceEur;
        priceDirection = rule.direction;
      } else if (t.kind === 'pru-net-pct') {
        kind = 'net-pct';
        percent = t.percent;
        feeKind = t.fee.pctFee === COINHOUSE_FEES['sell-eur'].pctFee ? 'sell-eur' : 'crypto-crypto';
      } else {
        kind = rule.direction === 'below' ? 'below-pct' : 'above-pct';
        percent = t.percent;
      }
      return;
    }
    formAsset = asset || (Object.keys(app.alertPositions).sort()[0] ?? '');
    kind = 'below-pct';
    percent = '10';
    // Suggestion éditable, pas un chiffre calculé : 2 décimales suffisent pour saisir un seuil.
    price = spotEur ? D(spotEur).round(2).toString() : '';
    priceDirection = 'below';
    feeKind = 'crypto-crypto';
    repeat = 'recurring';
    note = '';
  }

  const parseInput = (raw: string): Big | null => parseDecimal(raw.trim().replace(',', '.'));

  /** Règle en cours de saisie (aperçu et enregistrement partagent la même construction). */
  const draft = $derived.by((): AlertRule | null => {
    if (formAsset === '') return null;
    let threshold: AlertThresholdSpec;
    let direction: AlertDirection;
    if (kind === 'price') {
      const value = parseInput(price);
      if (value === null || value.lt('0')) return null;
      threshold = { kind: 'price', priceEur: value.toString() };
      direction = priceDirection;
    } else {
      const pct = parseInput(percent);
      if (pct === null || pct.lt('0')) return null;
      if (kind === 'net-pct') {
        threshold = { kind: 'pru-net-pct', percent: pct.toString(), fee: COINHOUSE_FEES[feeKind] };
        direction = 'above';
      } else {
        threshold = { kind: 'pru-pct', percent: pct.toString() };
        direction = kind === 'below-pct' ? 'below' : 'above';
      }
    }
    return {
      id: rule?.id ?? 'draft',
      asset: formAsset,
      direction,
      threshold,
      repeat,
      enabled: rule?.enabled ?? true,
      note,
      createdAt: rule?.createdAt ?? '',
    };
  });

  const threshold = $derived(draft ? alertThresholdEur(draft, position) : null);
  const conditionNow = $derived(
    draft !== null &&
      threshold !== null &&
      spotEur !== null &&
      alertConditionMet(draft.direction, D(spotEur), threshold),
  );
  const distance = $derived(
    threshold !== null && spotEur !== null ? alertDistance(D(spotEur), threshold) : null,
  );
  const needsPru = $derived(kind !== 'price');

  /** Un prix saisi suggère son sens par rapport au cours (l'utilisateur peut toujours changer). */
  function suggestDirection(): void {
    const value = parseInput(price);
    if (value === null || spotEur === null) return;
    priceDirection = value.lte(D(spotEur)) ? 'below' : 'above';
  }

  function save(): void {
    if (!draft) {
      toasts.push('Saisie invalide : vérifiez le seuil.', 'error');
      return;
    }
    if (needsPru && (position === null || position.pruEur === null)) {
      toasts.push('Pas de PRU pour cet actif : utilisez un seuil en prix.', 'error');
      return;
    }
    if (rule) {
      app.updateAlertRule({ ...draft, id: rule.id, createdAt: rule.createdAt });
      toasts.push('Alerte modifiée.', 'success');
    } else {
      app.addAlertRule(draft);
      toasts.push(
        conditionNow
          ? 'Alerte créée : condition déjà remplie, elle s’armera au re-franchissement.'
          : 'Alerte créée.',
        'success',
      );
    }
    open = false;
  }

  /** Échelle de prise de profit (pratique des meilleurs trackers) : trois paliers d'un geste. */
  function createLadder(): void {
    for (const pct of ['25', '50', '100']) {
      app.addAlertRule({
        asset: formAsset,
        direction: 'above',
        threshold: { kind: 'pru-pct', percent: pct },
        repeat: 'once',
        note: 'Échelle de prise de profit',
      });
    }
    toasts.push('Échelle créée : PRU +25 %, +50 %, +100 %.', 'success');
    open = false;
  }

  const KINDS: readonly FormKind[] = ['below-pct', 'above-pct', 'net-pct', 'price'];
  const KIND_LABELS: Record<FormKind, string> = {
    'below-pct': 'Repli sous le PRU',
    'above-pct': 'Objectif au-dessus du PRU',
    'net-pct': 'Objectif net de frais de vente',
    price: 'Prix exact',
  };
  const PCT_CHIPS: Record<FormKind, string[]> = {
    'below-pct': ['0', '5', '10', '20'],
    'above-pct': ['10', '25', '50', '100'],
    'net-pct': ['0', '10', '25', '50'],
    price: [],
  };
  const chips = $derived(PCT_CHIPS[kind]);
</script>

<Sheet bind:open title={rule ? 'Modifier l’alerte' : 'Créer une alerte'}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <label class="field">
      <span>Actif</span>
      <select bind:value={formAsset} disabled={rule !== null}>
        {#each heldAssets as code (code)}
          <option value={code}>{code.toUpperCase()} — {assetName(code)}</option>
        {/each}
      </select>
    </label>

    <fieldset>
      <legend>Type d’alerte</legend>
      {#each KINDS as value (value)}
        <label class="radio">
          <input type="radio" name="alert-kind" {value} bind:group={kind} />
          <span>{KIND_LABELS[value]}</span>
        </label>
      {/each}
    </fieldset>

    {#if kind === 'price'}
      <label class="field">
        <span>Prix en euros</span>
        <input
          type="text"
          inputmode="decimal"
          bind:value={price}
          oninput={suggestDirection}
          placeholder="ex. 50000"
        />
      </label>
      <label class="field">
        <span>Se déclenche quand le prix</span>
        <select bind:value={priceDirection}>
          <option value="below">passe en dessous</option>
          <option value="above">passe au-dessus</option>
        </select>
      </label>
    {:else}
      <label class="field">
        <span
          >{kind === 'below-pct' ? 'Écart sous le PRU (%)' : 'Objectif au-dessus du PRU (%)'}</span
        >
        <input type="text" inputmode="decimal" bind:value={percent} placeholder="ex. 10" />
      </label>
      <div class="chips" role="group" aria-label="Pourcentages rapides">
        {#each chips as chip (chip)}
          <button
            type="button"
            class="chip"
            class:active={percent === chip}
            onclick={() => (percent = chip)}>{chip === '0' ? 'PRU' : `${chip} %`}</button
          >
        {/each}
      </div>
      {#if kind === 'net-pct'}
        <label class="field">
          <span>Frais de sortie (grille Coinhouse, 18/08/2026)</span>
          <select bind:value={feeKind}>
            <option value="crypto-crypto">Conversion en stablecoin — 0,79 % + 0,12 €</option>
            <option value="sell-eur">Vente en euros — 1,29 % + 0,12 €</option>
          </select>
        </label>
      {/if}
    {/if}

    <label class="field">
      <span>Répétition</span>
      <select bind:value={repeat}>
        <option value="recurring">Récurrente (se réarme après re-franchissement)</option>
        <option value="once">Une seule fois</option>
      </select>
    </label>

    <label class="field">
      <span>Note (facultatif)</span>
      <input type="text" maxlength="200" bind:value={note} placeholder="Pourquoi ce seuil ?" />
    </label>

    <div class="preview" aria-live="polite">
      {#if needsPru && (position === null || position.pruEur === null)}
        <p class="warn">
          Pas de PRU connu pour cet actif (position clôturée ou incomplète) : choisissez « Prix
          exact ».
        </p>
      {:else if threshold !== null}
        <p>
          Seuil actuel : <strong>{fmtPrice(threshold)}</strong>
          {#if needsPru && position?.pruEur}
            <span class="muted">· PRU {fmtPrice(position.pruEur)} — le seuil suit votre PRU</span>
          {/if}
        </p>
        {#if spotEur !== null}
          <p class="muted">
            Prix actuel : {fmtPrice(spotEur)}
            {#if distance !== null}
              ({fmtPct(distance)} par rapport au seuil)
            {/if}
          </p>
        {/if}
        {#if conditionNow}
          <p class="warn">
            Condition déjà remplie au prix actuel : l’alerte s’armera quand le prix repassera de
            l’autre côté du seuil, puis se déclenchera au prochain franchissement.
          </p>
        {/if}
      {:else}
        <p class="muted">Saisissez un seuil pour voir l’aperçu.</p>
      {/if}
    </div>

    <div class="actions">
      <button class="primary" type="submit">{rule ? 'Enregistrer' : 'Créer l’alerte'}</button>
      {#if !rule && (kind === 'above-pct' || kind === 'net-pct')}
        <button
          class="secondary"
          type="button"
          onclick={createLadder}
          disabled={position === null || position.pruEur === null}
          >Créer l’échelle +25 / +50 / +100 %</button
        >
      {/if}
    </div>
  </form>
</Sheet>

<style>
  form {
    display: grid;
    gap: var(--space-3);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  .field > span {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
  }
  input,
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
    width: 100%;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-1);
  }
  legend {
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    margin-bottom: var(--space-1);
  }
  .radio {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: var(--space-1) var(--space-3);
    min-height: 32px;
    font-size: var(--fs-xs);
    color: var(--fg);
  }
  .chip.active {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .preview {
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    font-size: var(--fs-sm);
    display: grid;
    gap: var(--space-1);
  }
  .warn {
    color: var(--warn);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
  }
  .secondary:disabled {
    opacity: 0.5;
  }
</style>
