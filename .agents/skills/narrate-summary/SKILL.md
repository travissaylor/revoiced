---
name: narrate-summary
description: Produce a directed, multi-voice audio narration for a book summary using Gemini TTS. Use when the user asks to narrate a summary, generate/regenerate audio for a book, add character voices, or make the audio reading more dynamic. Covers casting voices, writing performance directions, and running the generator.
---

# Narrate a summary

You are the audio director. The script `scripts/generate-audio.mjs` handles the
Gemini TTS API (`gemini-3.1-flash-tts-preview`), chunking, caching, and MP3
assembly — your job is the creative work it cannot do: reading the summary,
casting voices, and writing the performance.

## Workflow

1. **Read the summary** at `summaries/<author-slug>/<title-slug>.md`, fully.
   Identify: the emotional arc (where the story brightens, darkens, turns),
   any **quoted dialogue** (text inside quotation marks — reported speech like
   "she asked for a divorce" does NOT count), and which characters speak.
2. **List the numbered paragraphs** the generator sees (your script must map
   onto these exactly):
   ```
   pnpm generate-audio <author>/<title> --paragraphs
   ```
3. **Author the narration script** at
   `summaries/<author-slug>/<title-slug>.narration.json` (schema below).
4. **Validate** — this checks text fidelity and prints the chunk plan without
   calling the API:
   ```
   pnpm generate-audio <author>/<title> --dry-run
   ```
   Fix any validation errors it reports and re-run until clean.
5. **Generate** (needs `GEMINI_API_KEY` in `.env`; add `--force` if an MP3
   already exists):
   ```
   pnpm generate-audio <author>/<title>
   ```
   Long summaries take several minutes (one API call per chunk, sequential).
   Run it in the background if convenient. Completed chunks are cached in
   `.audio-cache/`, so a failed run resumes where it left off. Note: the cache
   is keyed on voice+directive+text, so editing the narration script
   invalidates only the chunks it changes — regenerating after a small tweak
   is cheap.
6. **Verify**: confirm the MP3 landed at `public/audio/<author>/<title>.mp3`
   with a plausible duration (~1 min per 900 chars), then tell the user to
   listen and offer to adjust directions/casting. The site's audio player
   appears automatically once the file exists.

## Narration script schema

```json
{
  "cast": {
    "narrator": { "voice": "Sulafat", "style": "Narrate as a classic literary audiobook reader: warm, measured, unhurried" },
    "Gandalf":  { "voice": "Algenib", "style": "An old, gravelly, commanding wizard's voice, weighty and deliberate" }
  },
  "paragraphs": [
    { "para": 1, "direction": "Luminous and serene — savor the scene-setting" },
    { "para": 2, "direction": "A shadow enters; let unease creep in" },
    {
      "para": 3,
      "direction": "Tense confrontation",
      "parts": [
        { "text": "He turned at the door and said," },
        { "speaker": "Gandalf", "text": "\"You shall not pass.\"", "direction": "Thunderous, final" },
        { "text": "The hall fell silent." }
      ]
    }
  ]
}
```

Rules the generator enforces (violations fail `--dry-run` with a message):

- `cast.narrator.voice` is required. Every `speaker` used must exist in `cast`.
- `paragraphs` must contain exactly one entry per source paragraph, in order,
  with `para` numbered 1..N matching `--paragraphs` output.
- **Text is verbatim.** A plain entry needs no `text` (the source paragraph is
  used). If you supply `text` (to insert audio tags) or split a paragraph into
  `parts`, the concatenated text with tags stripped must reproduce the source
  paragraph exactly — you may never rewrite, drop, or reorder the author's
  words.
- `parts` entries default to `speaker: "narrator"` and inherit the entry's
  `direction` unless they set their own.

## Casting voices

The 30 prebuilt voices (name — Google's character descriptor): Zephyr —
Bright, Puck — Upbeat, Charon — Informative, Kore — Firm, Fenrir — Excitable,
Leda — Youthful, Orus — Firm, Aoede — Breezy, Callirrhoe — Easy-going,
Autonoe — Bright, Enceladus — Breathy, Iapetus — Clear, Umbriel — Easy-going,
Algieba — Smooth, Despina — Smooth, Erinome — Clear, Algenib — Gravelly,
Rasalgethi — Informative, Laomedeia — Upbeat, Achernar — Soft, Alnilam — Firm,
Schedar — Even, Gacrux — Mature, Pulcherrima — Forward, Achird — Friendly,
Zubenelgenubi — Casual, Vindemiatrix — Gentle, Sadachbia — Lively,
Sadaltager — Knowledgeable, Sulafat — Warm.

Guidance:
- Pick the **narrator** to match the book's overall register: Sulafat/Gacrux
  for literary and elegiac, Charon/Rasalgethi for essayistic, Fenrir/Sadachbia
  for high-energy adventure, Algenib for grim epics.
- Cast **characters** by contrast with the narrator and with each other —
  listeners must hear the switch (e.g. Leda for an ingenue, Algenib for a
  gravelly soldier, Kore/Alnilam for cold authority, Achernar for fragility).
- Only cast characters who have **quoted dialogue**. A summary with no quotes
  is a narrator-only performance — say so plainly rather than forcing voices in.
- Keep one voice per character for the whole book, and reuse the same casting
  across books in a series if one exists.

## Writing directions

- `direction` is a stage note for delivery, not content: mood, pacing,
  temperature ("Bleak and unsparing — dignity stripping away, told with
  pained restraint"). The generator prepends it as an instruction the model
  follows but does not speak.
- **Reuse the exact same direction string across adjacent paragraphs** that
  share a mood — consecutive same-voice/same-direction paragraphs merge into
  one API call, which is cheaper and gives smoother prosody. Aim for runs of
  2–4 paragraphs per direction; change the string only when the story turns.
- Make the arc move: openings and endings deserve their own directions; the
  middle should tighten or lift with the plot. Directions should complement,
  not repeat, the cast member's base `style`.
- **Inline audio tags** (`[sighs]`, `[whispers]`, `[grave]`, `[laughs]`,
  `[very slow]`, …) may be inserted into `text`/`parts` for mid-passage
  shifts and interjections. Use them sparingly — a handful per book at real
  turning points; directions do most of the work. Tags are stripped before
  fidelity checking, so they never count as rewriting the text.

## Troubleshooting

- Validation failures print the paragraph number and both texts — fix the
  JSON, never the summary markdown.
- HTTP 429s are retried automatically with backoff; persistent quota errors
  mean the key's daily preview quota is exhausted — report that to the user.
- If a voice sounds wrong for a passage, change the `direction` or recast, and
  rerun with `--force` (the cache makes this cheap — only changed chunks
  regenerate; `--force` just allows overwriting the existing MP3).
