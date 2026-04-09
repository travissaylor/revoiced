import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const summaries = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './summaries' }),
  schema: z.object({
    title: z.string(),
    author: z.string(),
    genre: z.string(),
    publication_year: z.number(),
    summary_generated: z.coerce.date(),
  }),
});

export const collections = { summaries };
