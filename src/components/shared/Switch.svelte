<script lang="ts">
  /**
   * Interrupteur partagé (décision n° 184, P124) : `role="switch"` plutôt qu'une case à cocher
   * nue, toute la ligne cliquable — le `<label>` porte le texte ET le contrôle, comportement natif
   * — et une cible tactile ≥ 44 px sous `(any-pointer: coarse)`, ≥ 24 px sinon (WCAG 2.2 SC 2.5.8).
   *
   * Réservé aux réglages BINAIRES À EFFET IMMÉDIAT (Réglages, Alertes, Marché…). Les listes à choix
   * multiples et les cases de confirmation (« ces deux fichiers portent sur le même périmètre »)
   * restent des cases à cocher ordinaires : le rôle switch suppose un état persistant qui bascule
   * seul, pas un consentement qu'on donne une fois (APG, patron switch).
   *
   * `checked`/`onCheckedChange` plutôt qu'un `bind:checked` Svelte : la plupart des appelants ne
   * possèdent pas la valeur dans un `$state` local, ils la lisent du store et la modifient par un
   * mutateur (`app.setUi`, `app.setAlertsSettings`…) — le même patron que le reste de
   * l'application (`checked={...} onchange={(e) => app.setXxx(...)}`), désormais réutilisable.
   */
  let {
    checked,
    onCheckedChange,
    label,
    disabled = false,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label: string;
    disabled?: boolean;
  } = $props();
</script>

<label class="switch-row" class:disabled>
  <span>{label}</span>
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    onchange={(e) => onCheckedChange(e.currentTarget.checked)}
  />
</label>

<style>
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: 24px;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  /* Cible tactile ≥ 44 px (var(--tap)) au doigt, ≥ 24 px sinon : la zone, pas le glyphe. */
  @media (any-pointer: coarse) {
    .switch-row {
      min-height: var(--tap);
    }
  }
  .switch-row.disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  input[type='checkbox'][role='switch'] {
    flex: 0 0 auto;
    appearance: none;
    -webkit-appearance: none;
    width: 40px;
    height: 24px;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-sunken);
    position: relative;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }
  input[type='checkbox'][role='switch']::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--fg-muted);
    transition:
      transform 0.15s ease,
      background-color 0.15s ease;
  }
  input[type='checkbox'][role='switch']:checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  input[type='checkbox'][role='switch']:checked::before {
    transform: translateX(16px);
    background: var(--accent-fg);
  }
  input[type='checkbox'][role='switch']:disabled {
    cursor: not-allowed;
  }
  input[type='checkbox'][role='switch']:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 999px;
  }
</style>
