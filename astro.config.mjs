import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://travissaylor.github.io',
  base: '/revoiced/',
  // Keep the pre-v7 spacing and Markdown typography for existing summaries.
  compressHTML: true,
  markdown: { processor: unified() },
  integrations: [sitemap()],
});
