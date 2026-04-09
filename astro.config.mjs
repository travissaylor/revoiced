import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tsaylor.github.io',
  base: '/revoiced/',
  integrations: [sitemap()],
});
