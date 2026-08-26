<script lang="ts">
  /**
   * Liste de constats (décision n° 40). Purement présentationnel : il reçoit des constats DÉJÀ
   * rendus en français (`renderInsights`) et ne calcule rien. Le ton n'est jamais porté par la
   * seule couleur — un repère textuel l'accompagne (WCAG 2.2 AA, contrôlé par axe en CI).
   */
  import type { RenderedInsight } from '$lib/format/insights';
  import { router } from '$lib/router.svelte';

  interface Props {
    insights: RenderedInsight[];
  }
  let { insights }: Props = $props();

  const TONE_LABEL = {
    positive: 'Favorable',
    negative: 'Défavorable',
    neutral: 'Information',
    attention: 'À regarder',
  } as const;
  const TONE_MARK = { positive: '▲', negative: '▼', neutral: '•', attention: '!' } as const;

  function linkOf(link: RenderedInsight['link']): string | null {
    if (link === null) return null;
    return link.route === 'asset'
      ? router.href({ name: 'asset', asset: link.asset })
      : router.href({ name: link.route });
  }
</script>

<ul class="insights">
  {#each insights as insight (insight.id)}
    {@const href = linkOf(insight.link)}
    <li class={insight.tone}>
      <p class="head">
        <span class="mark" aria-hidden="true">{TONE_MARK[insight.tone]}</span>
        <span class="sr-only">{TONE_LABEL[insight.tone]} —</span>
        {#if href}
          <a {href}>{insight.title}</a>
        {:else}
          <strong>{insight.title}</strong>
        {/if}
      </p>
      <p class="detail">{insight.detail}</p>
    </li>
  {/each}
</ul>

<style>
  .insights {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* 18rem : des colonnes assez larges pour une phrase entière (4 colonnes hachaient le texte). */
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: var(--space-2);
  }
  li {
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: var(--radius);
    padding: var(--space-2);
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }
  li.positive {
    border-left-color: var(--gain);
  }
  li.negative {
    border-left-color: var(--loss);
  }
  li.attention {
    border-left-color: var(--warn);
  }
  li.neutral {
    border-left-color: var(--accent);
  }
  .head {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    font-size: var(--fs-sm);
  }
  .mark {
    font-size: var(--fs-xs);
    line-height: 1;
  }
  li.positive .mark {
    color: var(--gain);
  }
  li.negative .mark {
    color: var(--loss);
  }
  li.attention .mark {
    color: var(--warn);
  }
  li.neutral .mark {
    color: var(--accent);
  }
  .detail {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
</style>
