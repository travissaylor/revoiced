import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://travissaylor.github.io',
  base: '/revoiced/',
  // Keep the pre-v7 spacing and Markdown typography for existing summaries.
  compressHTML: true,
  markdown: { processor: unified() },
  vite: {
    build: {
      // Retain Vite 7's CSS baseline, including media queries for Safari 16.
      cssTarget: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    },
  },
  integrations: [sitemap()],
});
