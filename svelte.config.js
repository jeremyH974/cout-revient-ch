import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Svelte 5 uniquement : la syntaxe « legacy » (export let, $:, on:click) devient une erreur.
    runes: true,
  },
};
