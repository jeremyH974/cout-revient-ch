<script lang="ts">
  /**
   * Réglages du récit narratif (P65) : l'opt-in, la clé — **en mémoire vive uniquement** — et le
   * bouton « Tester la clé ».
   *
   * Ce bouton n'est pas un confort. Il envoie une charge **fixe**, sans la moindre donnée
   * personnelle, et exerce pourtant toute la chaîne : la Content-Security-Policy du site publié,
   * l'en-tête d'accès navigateur, la version d'API, la clé, et le classement des échecs. C'est ce
   * qui permet de distinguer « ma clé est mauvaise » de « le récit n'a pas voulu de ma réponse »,
   * deux problèmes qui n'ont rien à voir et qu'un seul bouton confondrait.
   */
  import { refusalText } from '$lib/format/ai';
  import {
    ANTHROPIC_HOST,
    ANTHROPIC_MODEL_ID,
    ANTHROPIC_PROBE,
    anthropicAdapter,
    refusalOfError,
  } from '$lib/net/anthropic';
  import { app } from '../../state/app.svelte';
  import { aiKey } from '../../state/ai-key.svelte';
  import { toasts } from '../../state/ui.svelte';
  import ConsentSheet from '../ai/ConsentSheet.svelte';

  let consentOpen = $state(false);
  let busy = $state(false);

  /** Le modèle de la version installée ; `aiModelId` reste `null` tant qu'aucun choix n'est offert. */
  const modelId = $derived(app.state.ui.aiModelId ?? ANTHROPIC_MODEL_ID);

  function askThenTest(): void {
    if (!aiKey.present) {
      toasts.push('Collez d’abord votre clé : elle reste dans cet onglet.', 'error');
      return;
    }
    // Le consentement se redemande à chaque envoi, sauf pour une charge utile déjà confirmée à
    // l'identique pendant cette session — ici, la charge est fixe, donc une fois par session.
    if (aiKey.hasConsent(ANTHROPIC_PROBE, modelId)) void runTest();
    else consentOpen = true;
  }

  async function runTest(): Promise<void> {
    const key = aiKey.value;
    if (key === null || busy) return;
    busy = true;
    try {
      const reply = await anthropicAdapter(key, { modelId }).complete(ANTHROPIC_PROBE);
      toasts.push(`Clé valide : ${reply.modelId} a répondu.`, 'success');
    } catch (error) {
      toasts.push(refusalText(refusalOfError(error), 'none'), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="card group">
  <h2>Récit par intelligence artificielle</h2>
  <p class="muted small">
    Facultatif, décoché par défaut. Une fois activé, le rapport propose un court récit rédigé par un
    modèle de langage <strong>à partir des constats déjà calculés</strong> : le modèle ne calcule rien,
    et tout chiffre qu'il écrirait sans le retrouver dans ces constats fait rejeter le texte entier.
  </p>

  <label class="check"
    ><input
      type="checkbox"
      checked={app.state.ui.aiEnabled}
      onchange={(e) => app.setUi({ aiEnabled: e.currentTarget.checked })}
    /> Proposer le récit dans le rapport</label
  >

  <label class="field"
    >Votre clé d'API Anthropic
    <input
      type="password"
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      placeholder="collée à chaque session"
      onchange={(e) => aiKey.set(e.currentTarget.value)}
    />
  </label>

  <p class="warn small">
    <strong>Cette clé n'est enregistrée nulle part.</strong> Ni dans le stockage du navigateur, ni
    dans vos sauvegardes : elle vit dans cet onglet et disparaît au rechargement. Les deux autres
    clés de cette page (CoinGecko, explorateur) sont gratuites et en lecture seule ; celle-ci est un
    moyen de paiement, et c'est votre compte qui est facturé.
    {#if aiKey.present}<span class="ok">Clé en mémoire ({aiKey.hint}).</span>{/if}
  </p>

  <button class="secondary" type="button" onclick={askThenTest} disabled={busy}>
    {busy ? 'Appel en cours…' : 'Tester la clé'}
  </button>
  <p class="muted small">
    Envoie deux mots à <code>{ANTHROPIC_HOST}</code> — aucun montant, aucun actif, aucune date — pour
    vérifier que la clé et le chemin réseau fonctionnent.
  </p>
</section>

<ConsentSheet
  bind:open={consentOpen}
  request={ANTHROPIC_PROBE}
  {modelId}
  purpose="Test de votre clé : cet envoi ne contient aucune de vos données."
  discreet={app.state.ui.discreet}
  onsend={() => {
    aiKey.grantConsent(ANTHROPIC_PROBE, modelId);
    void runTest();
  }}
  oncancel={() => {}}
/>

<style>
  .ok {
    color: var(--gain);
  }
</style>
