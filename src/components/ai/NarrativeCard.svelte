<script lang="ts">
  /**
   * « Votre année en résumé » (P65) — la seule carte de l'application dont le texte n'est pas écrit
   * par l'application.
   *
   * ## La distinction n'est jamais portée par la seule couleur
   *
   * Trois marques indépendantes : une **bordure pointillée**, une **pastille textuelle** (« généré
   * par IA »), un **fond alternatif**. Un lecteur daltonien, un thème à fort contraste, une
   * impression en noir et blanc : dans les trois cas il reste au moins deux marques (WCAG 2.2 AA,
   * critère 1.4.1 — contrôlé par axe en CI).
   *
   * ## L'étiquette survit au copier-coller
   *
   * L'article 50 du règlement (UE) 2024/1689 impose la mention depuis le 02/08/2026. Une mention
   * qui ne vit que sur l'écran ne protège que le lecteur qui savait déjà : le presse-papier la
   * porte donc **en préfixe**, avant le texte. Les attributs `data-ai-generated`, `data-ai-model`
   * et `data-ai-at` en donnent la version lisible par machine — sans norme technique stabilisée à
   * ce jour (voir l'entrée `ai-act-marquage` de la veille réglementaire), donc choisie ici plutôt
   * que suivie.
   *
   * ## Un refus affiche le repli, pas une carte vide
   *
   * Une sortie refusée est jetée ENTIÈRE (décision n° 68) : la carte annonce alors le motif en
   * français et affiche le résumé déterministe, celui que l'application sait écrire seule. C'est le
   * même repli que le second avis (décision n° 67), et c'est la raison pour laquelle l'échec d'un
   * modèle ne fait jamais disparaître d'information.
   */
  import type { AiOutcome } from '$lib/ai/contract';
  import { AI_BADGE, aiLabelLine, refusalText } from '$lib/format/ai';
  import { fmtDate } from '$lib/format/fr';

  interface Props {
    /** `null` tant que rien n'a été demandé : la carte propose, elle ne déclenche jamais seule. */
    outcome: AiOutcome<string> | null;
    /** Le résumé déterministe, une ligne par constat : le repli, et la comparaison. */
    fallbackLines: readonly string[];
    busy: boolean;
    /** Faux quand aucune clé n'est en mémoire : le bouton le dit plutôt que d'échouer. */
    ready: boolean;
    onrequest: () => void;
    oncopy: (text: string) => void;
  }
  let { outcome, fallbackLines, busy, ready, onrequest, oncopy }: Props = $props();

  const ok = $derived(outcome !== null && outcome.status === 'ok' ? outcome : null);
  const refused = $derived(outcome !== null && outcome.status === 'refused' ? outcome : null);

  function copy(): void {
    if (ok === null) return;
    // L'étiquette PRÉFIXE le texte : elle doit survivre au collage dans un courriel ou un tableur.
    oncopy(`${aiLabelLine(ok.label)}\n\n${ok.value}`);
  }
</script>

<section
  class="card narrative"
  class:generated={ok !== null}
  data-ai-generated={ok === null ? undefined : 'true'}
  data-ai-model={ok?.label.modelId}
  data-ai-at={ok?.label.at}
>
  <header>
    <h2>Votre année en résumé</h2>
    {#if ok !== null}
      <p class="badge" title={ok.label.notice}>{AI_BADGE}</p>
    {/if}
  </header>

  {#if ok !== null}
    <p class="text">{ok.value}</p>
    <p class="notice">
      {ok.label.notice} Modèle : <code>{ok.label.modelId}</code>, le {fmtDate(
        ok.label.at.slice(0, 10),
      )}.
    </p>
    <div class="actions">
      <button class="secondary" type="button" onclick={copy}>Copier le récit</button>
      <button class="secondary" type="button" onclick={onrequest} disabled={busy}>
        {busy ? 'Rédaction…' : 'Rédiger de nouveau'}
      </button>
    </div>
  {:else if refused !== null}
    <p class="refused" role="status">{refusalText(refused.reason, refused.fallback)}</p>
    <ul class="fallback">
      {#each fallbackLines as line (line)}
        <li>{line}</li>
      {/each}
    </ul>
    <div class="actions">
      <button class="secondary" type="button" onclick={onrequest} disabled={busy || !ready}>
        {busy ? 'Rédaction…' : 'Réessayer'}
      </button>
    </div>
  {:else}
    <p class="muted">
      Un modèle de langage peut mettre vos constats en phrases. Il ne calcule rien : chaque chiffre
      de sa réponse doit se retrouver dans les constats ci-dessous, sans quoi le texte est écarté en
      entier et ce résumé reste celui de l'application.
    </p>
    <div class="actions">
      <button class="secondary" type="button" onclick={onrequest} disabled={busy || !ready}>
        {busy ? 'Rédaction…' : 'Rédiger le récit'}
      </button>
      {#if !ready}
        <span class="muted small">Collez votre clé d'API dans les réglages.</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  /* Trois marques indépendantes, dont deux survivent à une impression en noir et blanc. */
  .narrative.generated {
    border-style: dashed;
    background: var(--bg-sunken);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
  }
  .badge {
    margin: 0;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 0 var(--space-1);
    color: var(--fg-muted);
  }
  .text {
    margin: var(--space-2) 0 0;
    line-height: 1.6;
  }
  .notice,
  .refused {
    margin: var(--space-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .refused {
    border-left: 3px solid var(--warn);
    padding-left: var(--space-2);
    font-size: var(--fs-sm);
  }
  .fallback {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-4);
    font-size: var(--fs-sm);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--space-3);
  }
  /*
   * Le récit ne sort PAS au PDF ni à l'impression, en v1. Un rapport imprimé se transmet — à un
   * comptable, à un conseiller —, et un texte généré y voisinerait des chiffres calculés sans que
   * le lecteur suivant sache lequel est lequel. L'étiquette survit au presse-papier, où le colleur
   * est celui qui a vu la carte ; elle ne suffirait pas sur une feuille qui change de mains.
   */
  @media print {
    .narrative {
      display: none;
    }
  }
</style>
