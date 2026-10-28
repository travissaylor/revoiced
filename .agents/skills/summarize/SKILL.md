---
name: summarize
description: Generate a long-form book summary written in the author's authentic voice and style
user-invocable: true
argument-hint: Free-text description of the book (e.g., "The Great Gatsby by F. Scott Fitzgerald")
---

# Book Summary Generator

You are generating a long-form book summary that reads like the author themselves retold their own book. The user will provide a book title and author in free text — extract both from whatever they type.

## Steps

### 1. Identify the Book and Author

Parse the user's input to determine the book title and author. If you are uncertain about either:
- Ask clarifying questions before proceeding (e.g., "Did you mean X?" or "What genre is this?")
- Do NOT guess or hallucinate details for a book you don't recognize

### 2. Research

Always perform web research before writing, even for well-known books. Search for:
- Detailed plot summary / key arguments (fiction vs non-fiction)
- Character names, settings, and key events or concepts
- Examples of the author's prose style, sentence structure, and voice

This ensures accuracy on plot points and helps you nail the author's tone.

### 3. Determine Genre and Approach

Identify whether the book is fiction or non-fiction, and adapt:
- **Fiction:** Follow the narrative arc — characters, plot progression, conflict, resolution. Retell the story.
- **Non-fiction:** Follow the idea arc — core thesis, key arguments, frameworks, evidence, conclusions. Retell the ideas.

In both cases, the author's voice is paramount.

### 4. Write the Summary

Write a **5,000-7,000 word** continuous prose summary with these requirements. The word range is a hard limit: a file over 7,000 words (or under 5,000) is a failed task and must be revised before you finish.

**Author Voice (Critical):**
- Write in full immersion of the author's style — this is the entire point
- Match their syntax, vocabulary, sentence rhythm, tone, and quirks
- If it's Cormac McCarthy: sparse punctuation, bleak cadence, biblical register
- If it's Douglas Adams: dry wit, absurd tangents, cosmic irreverence
- If it's Toni Morrison: lyrical density, shifting perspectives, weighted silences
- Study what you found in research and channel it completely
- The reader should feel like they are reading the actual author's words

**Original prose only (hard rule):**
- This is a retelling in the author's voice, written by you. It is NOT a reproduction, abridgement, or lightly edited copy of the book.
- Never copy sentences or passages from the book, whether from memory or from research results. Every sentence must be your own construction.
- Short iconic lines (a slogan, a motto, a famous phrase under ~10 words) may appear at most once each, in quotation marks.
- Reproducing the book's text is a copyright violation and a failed task, no matter how good it reads.

**Content:**
- Cover the full scope of the book — all major plot points, characters, themes, or arguments
- Do not skip or gloss over important sections
- The reader should finish feeling they absorbed the book's substance

**Format:**
- Continuous prose — no section headers, no chapter markers, no bullet points
- It should read like a single flowing piece of writing

### 5. Create the File

**Frontmatter format:**
```yaml
---
title: "Book Title"
author: "Author Full Name"
genre: "Genre"
publication_year: YYYY
summary_generated: YYYY-MM-DD
---
```

Use today's date for `summary_generated`.

**File path:** Write the file to:
```
summaries/{author-slug}/{title-slug}.md
```

Where:
- `{author-slug}` is the author's full name, lowercased, spaces and punctuation replaced with hyphens (e.g., `f-scott-fitzgerald`)
- `{title-slug}` is the book title, lowercased, spaces and punctuation replaced with hyphens, articles kept (e.g., `the-great-gatsby`)

Create the author directory if it doesn't exist.

Write the file directly — do not display the full summary in the conversation.

### 6. Verify Before Finishing

Run these checks and fix any failure:
- `wc -w summaries/{author-slug}/{title-slug}.md` is between roughly 5,100 and 7,100 (frontmatter adds ~50 words).
- The file has no `#` headers, no bullet points, and no chapter markers.
- The book's actual opening sentence and closing sentence do not appear in the file. If either does, you have reproduced the text: rewrite the affected passages in your own words.
- Frontmatter has all five fields and today's date.
