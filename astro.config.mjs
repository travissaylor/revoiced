import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://travissaylor.github.io',
  base: '/revoiced/',
  integrations: [sitemap()],
});
