# PRD: Progressive Web App Support

## Introduction

Add progressive web app capabilities to the Revoiced static site so readers can install it to their home screen and read summaries offline. Visited pages are cached automatically, unvisited pages are prefetched opportunistically, and the Pagefind search index is cached for offline search. A branded offline fallback page guides users to cached content when they access something that hasn't been cached yet.

## Goals

- Make Revoiced installable as a standalone app on mobile and desktop
- Cache visited summary pages for offline reading
- Opportunistically prefetch unvisited summaries in the background
- Cache the Pagefind search index so search works offline
- Show a branded offline fallback page for uncached content
- Auto-generate app icons from the Revoiced branding
- Update cached content silently on subsequent visits

## User Stories

### US-001: Web app manifest

**Description:** As a reader, I want Revoiced to be installable so I can launch it from my home screen like a native app.

**Acceptance Criteria:**

- [ ] `manifest.json` generated with app name "Revoiced", short name "Revoiced", theme color matching the site's color scheme, and `display: standalone`
- [ ] Start URL set to the site's base path (`/revoiced/`)
- [ ] Manifest linked in the base layout `<head>` via `<link rel="manifest">`
- [ ] Apple-specific meta tags included (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`)
- [ ] Typecheck and lint pass

### US-002: Auto-generated app icons

**Description:** As a developer, I need app icons generated at build time so the manifest has valid icon references without manually creating image files.

**Acceptance Criteria:**

- [ ] Icons generated at 192x192 and 512x512 PNG sizes
- [ ] Icons use a simple text-based design with the site name or initial on the site's brand color
- [ ] Icons referenced correctly in the manifest
- [ ] Icons included in the build output
- [ ] Typecheck and lint pass

### US-003: Service worker with cache-on-visit strategy

**Depends on:** US-001

**Description:** As a reader, I want pages I've visited to be available offline so I can read them without an internet connection.

**Acceptance Criteria:**

- [ ] Service worker registered from the base layout
- [ ] App shell (HTML, CSS, JS, fonts) cached on service worker install
- [ ] Visited summary pages cached using a network-first strategy (serve fresh when online, fall back to cache when offline)
- [ ] Navigation and facet pages (homepage, author, genre, recent) cached on visit
- [ ] Service worker updates silently — new version activates on next visit without prompting the user
- [ ] Typecheck and lint pass

### US-004: Background prefetching of unvisited summaries

**Depends on:** US-003

**Description:** As a reader, I want the app to prefetch summaries I haven't visited yet so more content is available offline over time.

**Acceptance Criteria:**

- [ ] After the service worker installs and the page is idle, fetch a list of all summary URLs (from the sitemap or a generated index)
- [ ] Prefetch unvisited summary pages in the background without impacting page performance
- [ ] Prefetching uses `requestIdleCallback` or equivalent to avoid blocking the main thread
- [ ] Already-cached URLs are skipped
- [ ] Typecheck and lint pass

### US-005: Offline Pagefind search index caching

**Depends on:** US-003

**Description:** As a reader, I want search to work offline so I can find cached summaries without an internet connection.

**Acceptance Criteria:**

- [ ] Pagefind index files (`pagefind/*.pf_*`, `pagefind-ui.js`, `pagefind-ui.css`) are precached by the service worker
- [ ] Search returns results for cached pages when offline
- [ ] Typecheck and lint pass

### US-006: Branded offline fallback page

**Depends on:** US-003

**Description:** As a reader, I want to see a helpful page when I try to access uncached content offline, rather than a browser error.

**Acceptance Criteria:**

- [ ] Offline fallback page at `/offline` with Revoiced branding and a message explaining the user is offline
- [ ] Page suggests navigating to previously visited (cached) content
- [ ] Fallback page is precached by the service worker on install
- [ ] Service worker serves the fallback page for navigation requests that fail and are not in the cache
- [ ] Page respects the existing light/dark theme
- [ ] Typecheck and lint pass

## Functional Requirements

- FR-1: Generate a valid `manifest.json` with name, icons, theme color, start URL, and `display: standalone`
- FR-2: Generate 192x192 and 512x512 PNG icons at build time using the site's brand color and name
- FR-3: Register a service worker from the base layout on all pages
- FR-4: Cache the app shell (layout CSS/JS, fonts) on service worker install
- FR-5: Cache visited pages using a network-first strategy
- FR-6: Prefetch unvisited summary pages in the background during idle time
- FR-7: Precache Pagefind index files so search works offline
- FR-8: Serve a branded offline fallback page for uncached navigation requests that fail
- FR-9: Service worker updates activate silently without user prompts
- FR-10: All caching respects the site's base path (`/revoiced/`)

## Non-Goals

- No push notifications
- No background sync or queued actions
- No custom install prompt UI — rely on the browser's native install flow
- No offline analytics
- No manual cache management UI for the user

## Technical Considerations

- Use `@vite-pwa/astro` integration for service worker generation via Workbox, or a hand-rolled service worker if the integration adds too much complexity
- The site already uses `base: '/revoiced/'` in Astro config — all service worker scope and cache paths must account for this
- Icon generation can use `sharp` or `canvas` at build time, or a simple SVG-to-PNG approach
- Pagefind index files are generated post-build in `dist/pagefind/` — the service worker precache manifest needs to include these
- The offline fallback page should be a regular Astro page that gets precached

## Success Metrics

- Site passes Chrome Lighthouse PWA audit
- Previously visited summaries load fully offline
- Pagefind search returns results when offline
- App is installable on Chrome, Safari, and Firefox (mobile and desktop)

## Open Questions

- Should there be a visual indicator showing which summaries are cached/available offline?
