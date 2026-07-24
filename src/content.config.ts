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
    // Per-book TTS narration config used by scripts/generate-audio.mjs.
    // voice: a Gemini prebuilt voice name; style: a delivery directive.
    narration: z
      .object({
        voice: z.string(),
        style: z.string().optional(),
      })
      .optional(),
  }),
});

export const collections = { summaries };
