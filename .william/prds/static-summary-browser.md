# PRD: Static Summary Browser

## Introduction

Build a browsable, searchable static website for the author-toned book summaries collection. The site uses Astro with Content Collections pointed at the existing `summaries/` directory, Pagefind for weighted full-text search, and deploys to GitHub Pages via GitHub Actions. Users can browse summaries by author, genre, or recency, search across all content, and read long-form summaries with a polished reading experience.

## Goals

- Provide a browsable web interface for all book summaries in the collection
- Enable full-text search with weighted results (title/author ranked higher than body text)
- Support filtering by author, genre, and recently added
- Generate static pages per facet value for fast loading and SEO
- Automatically deploy to GitHub Pages on push to main
- Match system light/dark preference automatically
- Deliver a polished reading experience for 5,000-7,000 word summaries

## User Stories

### US-001: Astro project setup with Content Collections

**Description:** As a developer, I need an Astro project configured to use the existing `summaries/` directory as a content collection so that summaries are the single source of truth for both files and the website.

**Acceptance Criteria:**

- [ ] Astro project initialized in the repo root (config, package.json, tsconfig)
- [ ] Content collection defined pointing at `summaries/` with typed schema matching existing frontmatter: `title` (string), `author` (string), `genre` (string), `publication_year` (number), `summary_generated` (date)
- [ ] Astro can build successfully with zero summaries (empty collection)
- [ ] Existing `summaries/{author-slug}/{title-slug}.md` files are recognized as collection entries
- [ ] Typecheck and lint pass

### US-002: Summary detail pages

**Depends on:** US-001

**Description:** As a reader, I want to view a full book summary on its own page so that I can read the complete text in a comfortable format.

**Acceptance Criteria:**

- [ ] Each summary renders at `/{author-slug}/{title-slug}`
- [ ] Page displays frontmatter metadata (title, author, genre, publication year) in a header area
- [ ] Full summary prose renders below the header
- [ ] Reading progress bar visible as the user scrolls through the summary
- [ ] Comfortable reading width (max ~70ch) with good typography
- [ ] Typecheck and lint pass

### US-003: Base layout and dark mode

**Depends on:** US-001

**Description:** As a reader, I want the site to have a clean, cohesive design that respects my system light/dark preference so the reading experience is comfortable in any environment.

**Acceptance Criteria:**

- [ ] Base layout with site header (site name, navigation links to /author, /genre, /recent) and footer
- [ ] Search bar present in the header on every page (placeholder until Pagefind is integrated)
- [ ] Light and dark color schemes defined using CSS custom properties
- [ ] Site respects `prefers-color-scheme` media query automatically
- [ ] Typography optimized for long-form prose reading (serif or readable sans-serif body, clear heading hierarchy)
- [ ] Typecheck and lint pass

### US-004: Homepage with collection browser

**Depends on:** US-002, US-003

**Description:** As a reader, I want a homepage that serves as the entry point to browse all summaries so I can discover what's in the collection.

**Acceptance Criteria:**

- [ ] Homepage at `/` displays all summaries as a grid of cards
- [ ] Each card shows: title, author, genre, and publication year (no excerpt)
- [ ] Cards link to the summary detail page
- [ ] Cards are sorted alphabetically by title by default
- [ ] Brief introductory text at the top of the page describing the collection
- [ ] Responsive grid: adapts from 1 column (mobile) to 2-3 columns (desktop)
- [ ] Typecheck and lint pass

### US-005: Author facet pages

**Depends on:** US-001, US-003

**Description:** As a reader, I want to browse summaries by author so I can find all books by a specific writer.

**Acceptance Criteria:**

- [ ] Index page at `/author` listing all authors with summary counts
- [ ] Individual author pages at `/author/{author-slug}` showing all summaries by that author as cards
- [ ] Pages are statically generated at build time from collection data
- [ ] Typecheck and lint pass

### US-006: Genre facet pages

**Depends on:** US-001, US-003

**Description:** As a reader, I want to browse summaries by genre so I can find books in categories I enjoy.

**Acceptance Criteria:**

- [ ] Index page at `/genre` listing all genres with summary counts
- [ ] Individual genre pages at `/genre/{genre-slug}` showing all summaries in that genre as cards
- [ ] Genre is single-value per summary (matches existing frontmatter schema)
- [ ] Pages are statically generated at build time from collection data
- [ ] Typecheck and lint pass

### US-007: Recently added page

**Depends on:** US-001, US-003

**Description:** As a reader, I want to see recently added summaries so I can discover what's new in the collection.

**Acceptance Criteria:**

- [ ] Page at `/recent` showing summaries sorted by `summary_generated` date (newest first)
- [ ] Each entry displays the date it was added alongside the card info
- [ ] Page is statically generated at build time
- [ ] Typecheck and lint pass

### US-008: Pagefind search integration

**Depends on:** US-002, US-003

**Description:** As a reader, I want to search across all summaries by keyword so I can quickly find specific content, authors, or titles.

**Acceptance Criteria:**

- [ ] Pagefind installed and runs as a post-build step indexing the generated site
- [ ] Search bar in the header is wired to Pagefind's UI
- [ ] Title and author fields are weighted higher than body text in search results using Pagefind's `data-pagefind-weight` attributes
- [ ] Search results show title, author, and a text excerpt with highlighted matches
- [ ] Search works client-side with no server required
- [ ] Typecheck and lint pass

### US-009: GitHub Actions deployment

**Depends on:** US-008

**Description:** As a developer, I want the site to automatically build and deploy to GitHub Pages on push to main so the site stays up to date as new summaries are added.

**Acceptance Criteria:**

- [ ] GitHub Actions workflow file at `.github/workflows/deploy.yml`
- [ ] Workflow triggers on push to `main`
- [ ] Workflow installs dependencies, runs `astro build`, runs Pagefind indexing, and deploys output to GitHub Pages
- [ ] Astro configured with correct `site` and `base` settings for GitHub Pages
- [ ] Typecheck and lint pass

## Functional Requirements

- FR-1: Astro Content Collection must use the existing `summaries/{author-slug}/{title-slug}.md` directory structure as-is — no file moves or restructuring
- FR-2: Summary detail pages render at `/{author-slug}/{title-slug}` with full prose content and metadata header
- FR-3: Reading progress bar tracks scroll position on summary detail pages
- FR-4: Homepage displays all summaries as a responsive card grid (title, author, genre, year — no excerpts)
- FR-5: Author index at `/author` lists all authors; `/author/{slug}` shows that author's summaries
- FR-6: Genre index at `/genre` lists all genres; `/genre/{slug}` shows that genre's summaries
- FR-7: Recently added page at `/recent` sorts summaries by `summary_generated` descending
- FR-8: All facet and listing pages are statically generated at build time
- FR-9: Pagefind indexes the built site with title and author weighted higher than body content
- FR-10: Search bar appears in the site header on every page
- FR-11: Site respects `prefers-color-scheme` for automatic light/dark mode
- FR-12: GitHub Actions workflow builds and deploys to GitHub Pages on push to main

## Non-Goals

- No server-side rendering or API routes — fully static
- No client-side filtering or JavaScript-heavy interactions beyond Pagefind search
- No user accounts, comments, or ratings
- No RSS feed or newsletter
- No custom domain setup (use default GitHub Pages URL)
- No CMS or admin interface — summaries are added via the existing `/summarize` skill and git
- No pagination — all summaries display on listing pages (acceptable at expected scale of tens to low hundreds)

## Technical Considerations

- Astro's Content Collections API should define the schema with Zod to validate frontmatter
- The `summaries/` directory contains nested `{author-slug}/{title-slug}.md` — Astro content collections handle nested directories, using the relative path as the entry slug
- Pagefind is added as a post-build integration — it indexes the `dist/` output after Astro builds
- CSS custom properties for theming (light/dark) to keep styling maintainable
- Reading progress bar can be a lightweight vanilla JS component (Astro island)
- No framework (React, Vue, etc.) needed — Astro's built-in templating is sufficient

## Success Metrics

- All existing and future summaries are browsable on the site without manual intervention
- A reader can find a specific summary via search in under 5 seconds
- Site builds and deploys automatically on every push to main
- Lighthouse performance score > 90 on summary detail pages
- Site is fully usable with JavaScript disabled (except search)

## Resolved Questions

- **Site name:** "Revoiced" — books re-told in the author's voice
- **Hosting URL:** Standard GitHub Pages URL (`{username}.github.io/{repo}`) — no custom domain for now
