<script lang="ts">
  import { onMount } from 'svelte';
  import type { Big } from '$lib/domain/money';
  import { copyImageToClipboard, downloadBlob, shareBlobFile } from '$lib/export/download';
  import { shareCardModel, type ShareCardInput } from '$lib/export/share-card';
  import { renderShareCard, type ShareTheme } from '$lib/export/share-image';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import { toasts } from '../../state/ui.svelte';
  import Sheet from './Sheet.svelte';

  let {
    open = $bindable(false),
    netWorth = null,
    total = null,
  }: { open?: boolean; netWorth?: Big | null; total?: Big | null } = $props();

  /**
   * Volontairement **non mémorisé** : un réglage qui se souvient finit par publier ce qu'on ne
   * voulait publier qu'une fois. Chaque ouverture repart des pourcentages seuls.
   */
  let showAmounts = $state(false);
  let theme = $state<ShareTheme>('dark');
  let preview = $state<string | null>(null);
  let blob = $state<Blob | null>(null);
  let busy = $state(false);

  onMount(() => void history.ensure());
  $effect(() => {
    if (open) void history.ensure();
    else showAmounts = false;
  });

  const performance = $derived(open ? history.performance('btc') : null);
  const twr = $derived(performance?.twr.ok ? performance.twr.cumulative : null);
  const benchmark = $derived.by(() => {
    const b = performance?.benchmark;
    return b && b.twr.ok ? { label: b.asset.toUpperCase(), twr: b.twr.cumulative } : null;
  });
  const xirr = $derived(app.portfolioXirr?.ok === true ? app.portfolioXirr.rate : null);

  const input = $derived<ShareCardInput>({
    periodLabel: 'depuis le début',
    twr,
    xirr,
    benchmark,
    allocation: app.report.allocation.map((a) => ({ asset: a.asset, share: a.share })),
    positions: app.report.positions.length,
    amounts: showAmounts && netWorth !== null && total !== null ? { netWorth, total } : null,
    currency: app.currency,
  });
  const card = $derived(shareCardModel(input));

  /**
   * Signature du CONTENU rendu. `card` est un objet recréé à chaque recalcul dérivé : en dépendre
   * directement relancerait le rendu à la moindre variation d'état sans rapport, et chaque
   * relance annulerait la précédente — l'image ne se poserait jamais tant que les cours ou
   * l'historique bougent. On ne redessine donc que si les pixels changeraient vraiment.
   */
  const signature = $derived(`${theme}|${JSON.stringify(card)}`);

  // Le rendu suit cette signature. L'aperçu est une URL `data:` : la CSP du site publié refuse
  // `blob:` dans `img-src`, et l’image resterait vide sans la moindre erreur (voir `share-image.ts`).
  $effect(() => {
    if (!open) return;
    void signature;
    const model = card;
    const chosen = theme;
    let stale = false;
    void (async () => {
      const rendered = await renderShareCard(model, chosen);
      if (stale) return;
      blob = rendered.blob;
      preview = rendered.dataUrl;
    })();
    return () => {
      stale = true;
    };
  });

  const FILENAME = 'cout-revient-ch.png';

  async function share(): Promise<void> {
    if (!blob) return;
    busy = true;
    const done = await shareBlobFile(FILENAME, blob, 'image/png');
    busy = false;
    if (!done) toasts.push('Partage indisponible : téléchargez l’image.', 'error');
  }

  async function copyImage(): Promise<void> {
    if (!blob) return;
    busy = true;
    const done = await copyImageToClipboard(blob);
    busy = false;
    toasts.push(
      done ? 'Image copiée : collez-la dans Discord.' : 'Copie d’image indisponible ici.',
      done ? 'success' : 'error',
    );
  }

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(card.text);
      toasts.push('Résumé copié.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }
</script>

<Sheet bind:open title="Partager mes chiffres">
  <p class="lead">
    Des <strong>pourcentages</strong>, jamais vos montants. Ni quantité, ni adresse, ni date
    d'opération.
  </p>

  {#if preview}
    <!--
      `alt` porte les chiffres, pas une description : une carte annoncée « image de partage » ne dit
      rien à qui ne la voit pas. Le résumé texte ci-dessous en est l'équivalent complet.
    -->
    <img class="preview" src={preview} alt={card.text} />
  {:else}
    <p class="lead">Préparation de l'image…</p>
  {/if}

  <div class="options">
    <label class="check">
      <input type="checkbox" bind:checked={showAmounts} disabled={netWorth === null} />
      Afficher mes montants
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={theme === 'light'}
        onchange={(e) => (theme = e.currentTarget.checked ? 'light' : 'dark')}
      />
      Thème clair
    </label>
  </div>

  {#if card.hasAmounts}
    <p class="warn" role="status">
      Cette carte <strong>contient vos montants</strong>. Elle repassera en pourcentages seuls à la
      prochaine ouverture.
    </p>
  {/if}

  <div class="actions">
    <button type="button" onclick={share} disabled={!blob || busy}>Partager</button>
    <button class="secondary" type="button" onclick={copyImage} disabled={!blob || busy}
      >Copier l'image</button
    >
    <button
      class="secondary"
      type="button"
      onclick={() => blob && downloadBlob(FILENAME, blob)}
      disabled={!blob}>Télécharger</button
    >
    <button class="secondary" type="button" onclick={copyText}>Copier le résumé texte</button>
  </div>

  <details>
    <summary>Le résumé texte</summary>
    <pre>{card.text}</pre>
  </details>
</Sheet>

<style>
  .lead {
    margin: 0 0 var(--space-3);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .preview {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-3) 0;
  }
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap);
    font-size: var(--fs-sm);
  }
  .warn {
    margin: 0 0 var(--space-3);
    font-size: var(--fs-sm);
    border-left: 3px solid var(--accent-trading, var(--border));
    padding-left: var(--space-3);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  details {
    margin-top: var(--space-3);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  pre {
    white-space: pre-wrap;
    font-size: var(--fs-xs);
    margin: var(--space-2) 0 0;
  }
</style>
