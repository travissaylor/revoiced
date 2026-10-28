# Revoiced — agent guide

Static Astro site that publishes long-form book summaries written in each author's voice, with optional multi-voice audio narration.

## Skills

Repo skills live in `.agents/skills/` (the shared Agent Skills location read by Codex, Antigravity, and others). `.claude/skills/` contains symlinks to the same folders for Claude Code. Edit the files under `.agents/skills/` only.

- `summarize` — research a book, then write a 5,000–7,000 word summary to `summaries/<author-slug>/<title-slug>.md`. Requires web search.
- `narrate-summary` — cast voices, write `summaries/<author-slug>/<title-slug>.narration.json`, validate with `--dry-run`, then generate the MP3 with Gemini TTS.

Follow the skill's steps exactly. Write summary files directly; do not paste the full summary into chat.

## Commands

```
pnpm install
pnpm generate-audio <author-slug>/<title-slug> --paragraphs   # list numbered paragraphs
pnpm generate-audio <author-slug>/<title-slug> --dry-run      # validate narration script, no API calls
pnpm generate-audio <author-slug>/<title-slug>                # generate MP3 (needs GEMINI_API_KEY in .env)
pnpm build
```

If `pnpm` is not on PATH, use the Node install under `~/.nvm/versions/node/*/bin`.

## Environment

- `GEMINI_API_KEY` in `.env` (see `.env.example`) is required only for the final audio generation step. Dry runs work without it.
- Output audio lands in `public/audio/<author-slug>/<title-slug>.mp3`. Chunk cache is `.audio-cache/` (gitignored).

## Conventions

- Summary frontmatter: `title`, `author`, `genre`, `publication_year`, `summary_generated` (today's date).
- Slugs: lowercase, spaces and punctuation replaced with hyphens, articles kept (`the-great-gatsby`).
- Summaries are original retellings in the author's voice, 5,000–7,000 words. Never reproduce the book's text; copying passages is a copyright violation and a failed task.
- Never rewrite summary prose to satisfy narration validation; fix the narration JSON instead.
- Do not run git commands unless asked.
