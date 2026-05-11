# @aishop/web — Next.js 14 web shell

EPIC-6 deliverable. Foundation for EPIC-7/8 hero pages.

## Stack
- Next.js 14.2 (App Router) + React 18.3 + TypeScript 5.4 strict
- Tailwind 3.4 (utility-first; theme tokens map to CSS variables in `app/globals.css`)
- next-intl 3.26 (zh + en, `localePrefix='as-needed'`)
- shadcn/ui (button, dialog, dropdown-menu, command, tooltip, popover)
- TanStack Query 5 + openapi-fetch (typed client generated from FastAPI `/openapi.json`)
- Biome 1.9 (lint + format)
- Playwright 1.56 + playwright-image-snapshot + @axe-core/playwright (e2e + visual + a11y)

## Routes shipped in EPIC-6
- `/` (and `/<locale>`) — redirects to `/dashboard`
- `/dashboard` (and `/<locale>/dashboard`) — full shell (Sidebar + Topbar) with a Placeholder content area. EPIC-7 fills the content.

Other 8 sidebar items render as `aria-disabled` with a "Coming in EPIC-X" tooltip.

## Scripts

```bash
pnpm install                # install deps
pnpm --filter @aishop/web gen:api      # generate typed API client from live FastAPI
pnpm --filter @aishop/web dev          # next dev (http://localhost:3000)
pnpm --filter @aishop/web build        # next build
pnpm --filter @aishop/web check:tokens # token-drift guard (globals.css ↔ tailwind.config.ts)
pnpm --filter @aishop/web lint         # biome check
pnpm --filter @aishop/web typecheck    # tsc --noEmit
pnpm --filter @aishop/web test:e2e:install  # install Playwright chromium binary (~200MB)
pnpm --filter @aishop/web test:e2e          # run Playwright e2e suite
```

Or via Makefile from repo root:

```bash
make gen-api    # boot uvicorn → fetch /openapi.json → regenerate types
make web-build  # gen-api then next build
make web-e2e    # Playwright e2e
```

## API client regeneration (gen:api)

`scripts/gen-api.mjs` boots `uvicorn apps.api.main:app` on a free port, fetches `/openapi.json`,
overwrites `packages/schemas/openapi.yaml`, and runs `openapi-typescript` to refresh
`packages/schemas/ts/api-paths.ts`. CI runs this before `next build` so the typed client stays
in sync with the live FastAPI surface.

## Theme + locale

- **Theme**: dark default. Toggle in Topbar (and ⌘K command palette) swaps `html[data-theme]` between `dark` and `light`. Persisted in `localStorage` (`aishop:theme`).
- **Locale**: zh default. Toggle in Topbar updates URL prefix (zh has no prefix, en lives under `/en/...`) and writes the `NEXT_LOCALE` cookie that next-intl middleware honors.

## E2E test setup

Playwright config (`playwright.config.ts`) auto-boots the Next.js dev server. The Topbar's
`/api/health` call is mocked at the network layer per-test (see `tests/web/_helpers/mock-health.ts`),
so e2e doesn't depend on a running FastAPI instance. Visual snapshot baselines are committed
under `tests/web/__snapshots__/` — regenerate with `pnpm test:e2e -- --update-snapshots`.

## Notes

- `components/ui/` is shadcn-generated and excluded from Biome via `biome.json`. Don't manually format these files.
- `lib/nav.ts` is the single source of truth for sidebar nav items. Adding a new route means setting `enabled: true` on the matching item.
- Token additions must go in `app/globals.css` first, then `tailwind.config.ts` — the `check:tokens` script catches drift.
