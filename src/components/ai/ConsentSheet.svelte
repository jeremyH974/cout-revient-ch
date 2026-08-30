<script lang="ts">
  /**
   * Consentement **par usage** : cette feuille s'ouvre à CHAQUE envoi vers le modèle, et elle
   * montre le contenu réel, pas un résumé de ce contenu.
   *
   * Un interrupteur « autoriser l'IA » posé une fois dans les réglages serait plus confortable et
   * strictement moins informatif : ce qui part change à chaque import, à chaque rafraîchissement
   * de prix, à chaque changement de devise. Consentir une fois pour toutes, c'est consentir à des
   * données qu'on n'a pas vues. La mémorisation existe donc, mais elle est liée à l'**empreinte de
   * la charge utile** (`aiKey.hasConsent`) : la même requête, à l'identique, ne se redemande pas ;
   * tout le reste se redemande.
   *
   * Le corps affiché est le corps envoyé, réindenté, **jamais tronqué** : sa taille est annoncée,
   * il défile, et un bouton lève la limite de hauteur. Un « … » à la fin d'un aperçu, c'est
   * exactement l'endroit où une donnée inattendue passerait inaperçue.
   */
  import { tick } from 'svelte';
  import {
    ANTHROPIC_HOST,
    ANTHROPIC_MAX_TOKENS,
    anthropicBody,
    estimateCost,
  } from '$lib/net/anthropic';
  import type { ModelRequest } from '$lib/ai/contract';
  import Sheet from '../shared/Sheet.svelte';

  interface Props {
    open: boolean;
    /** La requête exacte : c'est elle qu'on affiche, pas une reconstitution. */
    request: ModelRequest;
    modelId: string;
    /** Ce que cet envoi sert à obtenir, en une ligne (« Récit de votre rapport »). */
    purpose: string;
    /** Mode discret actif : l'avertissement change de ton, il ne disparaît jamais. */
    discreet: boolean;
    onsend: () => void;
    oncancel: () => void;
  }
  let {
    open = $bindable(false),
    request,
    modelId,
    purpose,
    discreet,
    onsend,
    oncancel,
  }: Props = $props();

  /** Le corps envoyé, réindenté pour être lu. Même contenu, au caractère près. */
  const body = $derived(JSON.stringify(JSON.parse(anthropicBody(request, modelId)), null, 2));
  const cost = $derived(estimateCost(request));
  const size = $derived(new Intl.NumberFormat('fr-FR').format(body.length));

  let expanded = $state(false);
  let cancelEl = $state<HTMLButtonElement | undefined>();

  // « Annuler » reçoit le focus initial : la voie sûre est celle qu'on atteint sans rien viser.
  $effect(() => {
    if (!open) return;
    void tick().then(() => cancelEl?.focus());
  });

  function cancel(): void {
    open = false;
    oncancel();
  }
  function send(): void {
    open = false;
    onsend();
  }
</script>

<Sheet bind:open title="Envoyer ces données à un modèle de langage ?">
  <p class="lead">{purpose}</p>

  <dl class="facts">
    <dt>Destination</dt>
    <dd><code>{ANTHROPIC_HOST}</code> (Anthropic)</dd>
    <dt>Modèle</dt>
    <dd><code>{modelId}</code></dd>
    <dt>Plafond de sortie</dt>
    <dd>{ANTHROPIC_MAX_TOKENS} jetons, exactement</dd>
    <dt>Coût de cet envoi</dt>
    <dd>
      au plus {cost.totalUsd} $ — dont {cost.outputUsd} $ de sortie (plafond exact) et environ
      {cost.inputUsd} $ d'entrée (ordre de grandeur, l'entrée n'est pas comptée jeton par jeton). Facturé
      sur <strong>votre</strong> compte Anthropic.
    </dd>
  </dl>

  <details open>
    <summary>Consigne envoyée au modèle (intégrale)</summary>
    <pre class="code">{request.system}</pre>
  </details>

  <p class="label">
    Données envoyées — {size} caractères, affichés en entier
    <button class="link" type="button" onclick={() => (expanded = !expanded)}>
      {expanded ? 'réduire' : 'tout afficher'}
    </button>
  </p>
  <pre class="code payload" class:expanded>{body}</pre>

  <h3>Ce qui ne part jamais</h3>
  <ul>
    <li>Vos lignes d'opérations, vos lots, et les dates de vos opérations.</li>
    <li>Vos adresses publiques, vos clés publiques étendues, vos comptes.</li>
    <li>
      Votre clé d'API : elle voyage en en-tête vers cette seule origine, jamais dans le texte
      ci-dessus, et elle n'est enregistrée nulle part — ni sauvegarde, ni stockage du navigateur.
    </li>
  </ul>

  <p class="warn">
    {#if discreet}
      <strong
        >Le mode discret est actif : il masque les montants à l'écran, pas dans cet envoi.</strong
      >
      Les chiffres ci-dessus partent tels quels.
    {:else}
      Le mode discret masque les montants <strong>à l'écran seulement</strong> : il ne masquerait rien
      de cet envoi.
    {/if}
  </p>

  <div class="actions">
    <button bind:this={cancelEl} class="secondary" type="button" onclick={cancel}>Annuler</button>
    <button class="primary" type="button" onclick={send}>Envoyer</button>
  </div>
</Sheet>

<style>
  .lead {
    margin: 0 0 var(--space-3);
    color: var(--fg-muted);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-3);
  }
  .facts dt {
    color: var(--fg-muted);
  }
  .facts dd {
    margin: 0;
  }
  .code {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-2);
    margin: var(--space-1) 0 var(--space-3);
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Hauteur bornée, CONTENU entier : la barre de défilement remplace le « … ». */
  .payload {
    max-height: 14rem;
  }
  .payload.expanded {
    max-height: none;
  }
  .label {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  summary {
    cursor: pointer;
  }
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--fs-sm);
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
  }
  .warn {
    margin: var(--space-3) 0 0;
    border-left: 3px solid var(--warn);
    padding-left: var(--space-2);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-4);
  }
</style>
