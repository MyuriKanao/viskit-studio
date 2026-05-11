# Deep Interview Spec: EPIC-6 — Web Shell (Next.js base)

## Metadata
- Interview Date: 2026-05-11
- Rounds: 8
- Final Ambiguity Score: 7%
- Type: brownfield
- Threshold: 10%
- Status: PASSED
- Plan reference: `.omc/plans/aishop-studio-v1-plan.md` lines 359-379
- Pivoted from: EPIC-5 Text-touchup Editor (deferred — EPIC-6 ships first)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.333 |
| Constraint Clarity | 0.92 | 25% | 0.230 |
| Success Criteria | 0.92 | 25% | 0.230 |
| Context Clarity | 0.9 | 15% | 0.135 |
| **Total Clarity** | | | **0.928** |
| **Ambiguity** | | | **0.072 (~7%)** |

## Goal

Ship the Next.js 14 web shell — global layout chrome (Sidebar + Topbar), 5 atomic components, i18n routing, theme toggle, command-palette stub, real-API integration via TanStack Query backed by build-time-generated typed clients from FastAPI's live `/openapi.json`, and the first routable page (`/dashboard`) with a Placeholder content area — at design-brief.md fidelity (≤3 sRGB units pixel parity vs `demo/index.html#dashboard` for shell chrome only) and Lighthouse a11y ≥90.

This EPIC produces the foundation that EPIC-7 (Hero pages: Dashboard, Kit Detail, Providers, Onboarding) and EPIC-8 (Remaining 7 pages) plug into.

## Constraints (locked decisions)

1. **Sequencing:** EPIC-6 ships before EPIC-5 (Text-touchup Editor). EPIC-5 spec stays deferred until EPIC-6 ships.
2. **API integration:** Real API + TanStack Query 5 full integration. No mock data in EPIC-6 routes (Placeholder is a deliberate "EPIC-7 will fill this" UI affordance, not a mock-data fallback).
3. **shadcn/ui:** Full install — shadcn/ui main + atom rewrite using shadcn primitives as the base. Sidebar/Topbar wrap shadcn primitives where applicable. All new EPIC-6 components are shadcn/Tailwind-based.
4. **Visual + a11y verification:** Playwright @1.56 + `@playwright/test` + `playwright-image-snapshot` + `@axe-core/playwright`. CI gate runs visual snapshot diff vs demo (3 sRGB threshold) + axe-core a11y audit (≥90 score) on every EPIC-6 route.
5. **CSS strategy:** Tailwind utility-first for all new components. `tailwind.config.ts` extends with theme tokens that map to CSS variables from `tokens.css` (already in `apps/web/app/globals.css`). `demo/app.css` is NOT ported into the codebase — it's a mockup-quality reference, not a source of truth.
6. **Routable pages:** EPIC-6 ships only `/` (redirects to `/dashboard`) and `/dashboard` (renders shell + `<Placeholder />` content area). The other 4 hero pages (kit-detail, providers, onboarding) are EPIC-7's deliverable.
7. **Sidebar nav scope:** Sidebar renders all 9 nav items per demo (Dashboard, Catalog, New Kit, Vault, Templates, Queue, Editor, Providers, Settings). Items with no implemented route render in `disabled` state (`aria-disabled=true` + tooltip "Coming in EPIC-X"). Visual diff stays in sync with demo.
8. **API typed-client generation:** Build-time `pnpm gen:api` script:
   1. Boots `uvicorn apps.api.main:app` on a temp port
   2. Fetches `http://localhost:<port>/openapi.json`
   3. Writes the result into `packages/schemas/openapi.yaml` (overwriting `paths: {}` placeholder)
   4. Runs `openapi-typescript` to generate `packages/schemas/ts/api-paths.ts`
   5. CI runs this script before `pnpm -r build` so types stay in sync with FastAPI routes
9. **i18n:** `next-intl` 3.26.5 already installed. EPIC-6 wires it into the root layout, ships zh+en messages for sidebar nav labels, topbar items, command-palette titles, and the Placeholder strings. Locale toggle persists via cookie (per AC #3).
10. **Theme toggle:** Dark-default. Toggle swaps `--ink-base-l` vs `--ink-base` per plan AC #4. Light-mode polish beyond token-swap is OUT OF SCOPE (deferred to EPIC-10).
11. **Atom set:** All 5 demo atoms (`StatusChip`, `ComplianceRing`, `Sparkline`, `LocaleFlag`, `Placeholder`) ship in EPIC-6 (Tailwind + shadcn-based rewrites).
12. **Command palette:** ⌘K opens `cmdk`-based palette (shadcn ports cmdk). Items registered in EPIC-6: navigate-to-dashboard, toggle-locale, toggle-theme. Other commands deferred to EPIC-7+.

## Non-Goals

- No mock data in EPIC-6 routes (Placeholder is content-area-only; everything else is real)
- No light-mode polish beyond token-swap (EPIC-10)
- No Storybook setup (Playwright + axe-core on real routes covers the verification surface)
- No port of `demo/tweaks-panel.jsx` (dev-tool, not production)
- No port of `demo/landing.html` or `demo/onboarding.html` (EPIC-11 marketing site / EPIC-7 onboarding flow)
- No verbatim port of `demo/app.css` (Tailwind-ified per constraint 5)
- No fabric.js / canvas dependencies (those are EPIC-5)
- No Playwright e2e tests for backend routes (covered by pytest)

## Acceptance Criteria

- [ ] **AC #1 (Visual diff):** Playwright + `playwright-image-snapshot` runs against `/dashboard` (with Placeholder content area). Compares sidebar layout, topbar spacing, and token colors with `demo/index.html#dashboard`. Pixel diff ≤3 sRGB units on the shell chrome (sidebar + topbar regions); content area is masked from comparison.
- [ ] **AC #2 (Command palette):** Pressing ⌘K (or Ctrl+K) opens a `cmdk`-based command palette. Initial commands: `Go to Dashboard`, `Toggle locale (zh ↔ en)`, `Toggle theme (dark ↔ light token swap)`. Closing via Esc works. Verified by Playwright.
- [ ] **AC #3 (Locale toggle persists across reload):** Locale toggle in topbar updates the URL prefix (`/zh/dashboard` ↔ `/en/dashboard`) AND writes a cookie that next-intl middleware honors on subsequent requests. Verified by Playwright: toggle locale → reload → assert URL + page strings match new locale.
- [ ] **AC #4 (Theme toggle):** Theme toggle in topbar applies the `--ink-base-l` vs `--ink-base` swap from `tokens.css`. Persisted in localStorage (or cookie). Verified by Playwright + DOM inspection of the `[data-theme]` attribute.
- [ ] **AC #5 (a11y ≥90):** `@axe-core/playwright` runs on `/` and `/dashboard` and reports a Lighthouse-equivalent a11y score ≥90 (no violations of severity `serious` or `critical`). Every interactive element (sidebar nav items, topbar buttons, command palette items, theme/locale toggles) has an explicit `aria-label`. Disabled sidebar items use `aria-disabled=true`.
- [ ] **AC #6 (TanStack Query smoke test):** TanStack Query Provider wraps the root layout. A `useHealth()` hook calls `GET /api/health` via the generated typed client. The Topbar renders a `StatusChip` reflecting the health response (`ok` → green, anything else → amber). Verified by Playwright with the API actually running (or with `apps/api` mocked at the network layer).
- [ ] **AC #7 (Build-time API codegen):** `pnpm gen:api` script exists in `apps/web/package.json`. Running it boots uvicorn, fetches `/openapi.json`, updates `packages/schemas/openapi.yaml` with the live paths, and regenerates `packages/schemas/ts/api-paths.ts`. The CI pipeline runs `pnpm gen:api` before `pnpm -r build` so type drift fails fast.
- [ ] **AC #8 (Sidebar disabled state):** Sidebar renders 9 nav items per `demo/components.jsx:Sidebar`. The Dashboard item is enabled; the other 8 render with `aria-disabled=true`, a greyed-out visual treatment per the design tokens, and a tooltip ("Coming in EPIC-7" / "Coming in EPIC-8" / etc.). Verified by Playwright.
- [ ] **AC #9 (No CSS regression):** `tailwind.config.ts` extends theme with all `tokens.css` variables (color/spacing/typography/radii/shadows/motion). The compiled CSS is ≤30KB gzipped (Tailwind JIT tree-shakes unused utilities; demo/app.css's 40KB is NOT inherited).
- [ ] **AC #10 (Biome + tsc clean):** `pnpm -r lint` and `pnpm -r typecheck` both pass with zero warnings on EPIC-6 scope. shadcn/ui-generated component files exempted via biome.json overrides only if needed.

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| WebShell | core | layout, sidebar, topbar, theme, locale | wraps all routes |
| Sidebar | shell-chrome | nav_items (9), active_route, locale-aware labels | renders inside WebShell; routes to all hero pages |
| Topbar | shell-chrome | command_palette_trigger, theme_toggle, locale_toggle, health_chip | renders inside WebShell; consumes useHealth() |
| NavItem | atom | id, label_key, route, enabled, comingInEpic | child of Sidebar; disabled state per constraint 7 |
| StatusChip | atom | status: ok\|warn\|error, label, aria-label | used by Topbar (health) + EPIC-7+ kit cards |
| ComplianceRing | atom | score 0-100, color | EPIC-7+ kit detail; defined in EPIC-6 |
| Sparkline | atom | data points, color | EPIC-7+ KPI cards; defined in EPIC-6 |
| LocaleFlag | atom | locale: zh\|en | Topbar locale toggle UI |
| Placeholder | atom | label, target_epic | content area of /dashboard until EPIC-7 |
| CommandPaletteItem | atom | id, label_key, action, shortcut? | registered via cmdk; initial set: 3 items |
| ThemeMode | enum | dark, light-token-swap | persisted in localStorage |
| Locale | enum | zh, en | persisted in cookie via next-intl |
| TypedApiClient | infra | generated paths from /openapi.json, hooks via TanStack Query | apps/web/lib/api/ |
| HealthResponse | dto | status, postgres, milvus, redis, minio | from /api/health |

## Ontology Convergence

| Round | Entity Count | New | Stable | Stability |
|-------|-------------|-----|--------|-----------|
| 1 (sequencing) | 4 | 4 | - | N/A |
| 2 (api scope) | 7 | 3 | 4 | 57% |
| 3 (visual+a11y) | 9 | 2 | 7 | 78% |
| 4 (shadcn scope) | 11 | 2 | 9 | 82% |
| 5 (app.css) | 12 | 1 | 11 | 92% |
| 6 (page scope) | 13 | 1 | 12 | 92% |
| 7 (api codegen) | 14 | 1 | 13 | 93% |
| 8 (sidebar nav) | 14 | 0 | 14 | 100% |

## Decisions Resolved

| Round | Question | Decision |
|-------|----------|----------|
| 1 | EPIC-6 sequencing? | Do EPIC-6 first, EPIC-5 deferred |
| 2 | API integration scope? | Real API + TanStack Query full integration |
| 3 | Visual + a11y verification tooling? | Playwright + image-snapshot + axe-core (full CI gate) |
| 4 | shadcn/ui scope? | Full — install + rewrite atoms with shadcn primitives |
| 5 | demo/app.css strategy? | Tailwind-ify everything; app.css NOT ported |
| 6 | Routable pages in EPIC-6? | Only `/` and `/dashboard`; Placeholder content area |
| 7 | TanStack Query typed-client source? | Build-time gen from FastAPI /openapi.json |
| 8 | Sidebar non-implemented routes? | All 9 items render; 8 with aria-disabled+tooltip |

## Technical Context (brownfield findings)

**apps/web/ baseline (already in EPIC-0):**
- Next.js 14.2.29 + React 18.3.1 + Tailwind 3.4.17 + Biome 1.9.4
- next-intl 3.26.5 installed; `[locale]/` route segment, `i18n/routing.ts`, `i18n/request.ts`, `middleware.ts` exist
- `messages/` directory exists (translation files; need EPIC-6 sidebar/topbar strings added)
- `tokens.css` ALREADY ported to `apps/web/app/globals.css`
- `tsconfig.json` paths: only `@/*` → root (need `@/components`, `@/lib`, `@/hooks` aliases added)
- NOT installed: shadcn/ui, TanStack Query, Playwright, cmdk
- biome.json configured

**packages/schemas/ baseline:**
- `openapi.yaml` is types-only with `paths: {}` (will be overwritten by `pnpm gen:api`)
- `python/models.py` and `ts/index.ts` already generated
- `gen:ts` script uses `openapi-typescript`; `gen:py` uses custom pydantic generator
- Adding `gen:api` script (boot uvicorn + fetch /openapi.json + overwrite + regen)

**demo/ source of truth (Babel-standalone mockup):**
- `tokens.css` (4.84 KB) ✅ already ported
- `app.css` (39.93 KB) ❌ NOT being ported (Tailwind-ified instead)
- `components.jsx` (12 KB) — Icon, StatusChip, ComplianceRing, Sparkline, LocaleFlag, Sidebar, Topbar, Placeholder
- `dashboard.jsx`, `kit-detail.jsx`, `providers.jsx` — EPIC-7 references
- `tweaks-panel.jsx`, `landing.html`, `onboarding.html` — NOT in scope for EPIC-6

**apps/api/ baseline (from EPIC-0..4B, all backend EPICs done):**
- 305 pytest passing
- Routes: `/api/health`, `/api/retrieval/search`, `/api/copywriter/spec`, `/api/kits/{id}/generate`, `/api/kits/{id}/events` (SSE)
- FastAPI auto-emits `/openapi.json` from pydantic models — perfect feedstock for the codegen pipeline

## Story Sketch (informational; the formal PRD will refine)

Estimated 9-10 stories per the AC list, organised in 4 stages:

**Stage A (parallel): Foundation**
- US-6.1: tailwind.config.ts extends theme tokens from tokens.css
- US-6.2: shadcn/ui install + initial component pull (button, dialog, dropdown, command, tooltip, popover)
- US-6.3: tsconfig.json path aliases (@/components, @/lib, @/hooks)

**Stage B (sequential after A): API plumbing**
- US-6.4: `pnpm gen:api` script (boot uvicorn + fetch + write openapi.yaml + openapi-typescript)
- US-6.5: TanStack Query setup + `apps/web/lib/api/client.ts` + `useHealth()` hook

**Stage C (parallel after B): UI atoms + shell chrome**
- US-6.6: 5 atoms (StatusChip, ComplianceRing, Sparkline, LocaleFlag, Placeholder) as shadcn/Tailwind-based components
- US-6.7: Sidebar component with 9 nav items + disabled state for 8
- US-6.8: Topbar component with health chip, locale toggle, theme toggle, ⌘K trigger
- US-6.9: Root layout integration (TanStack Provider, next-intl Provider, theme provider) + /dashboard placeholder route

**Stage D: Verification**
- US-6.10: Playwright + image-snapshot + axe-core install + 5 AC tests (visual diff, ⌘K, locale toggle, theme toggle, a11y)

## Risks

- **shadcn/ui + Biome formatting** — shadcn-generated files may need biome.json overrides (formatter conflicts)
- **next-intl middleware + cookies** — locale persistence via cookie under next-intl 3.x has subtle edge cases (cookie name, domain, path)
- **Playwright in CI** — first-time install adds 200MB browser binaries; CI cache strategy needed
- **`pnpm gen:api` requires uvicorn boot** — CI must have Python venv ready before web build; ordering in Makefile/CI script matters
- **Tailwind config + tokens.css duplication** — tokens.css declares CSS variables; tailwind.config.ts maps utilities to those variables. Drift between the two is a real risk; mitigate by deriving config from tokens.css programmatically OR by keeping tokens.css as the single source and tailwind.config.ts as just `var(--ink-base)` references.

## Out of Scope (explicit)

- EPIC-5 (Text-touchup Editor) — interview pivoted; EPIC-5 spec stays deferred until EPIC-6 ships
- EPIC-7 hero pages full implementations (only Placeholder in EPIC-6)
- demo/app.css contents (Tailwind-ified per Constraint 5)
- Light-mode polish beyond `--ink-base` ↔ `--ink-base-l` token swap (EPIC-10)
- Storybook component-isolation testing
- E2E for backend routes (pytest already covers)
