# ADR-EPIC10-002: Tag combobox = cmdk wrapper with explicit a11y contract

- **Status:** Accepted
- **Date:** 2026-05-15
- **Context EPIC:** EPIC-10 — Batch Tag (Vault assets, Tier 3)
- **Related:** spec, plan §2, scripts/grep_radix_surface.sh ALLOWED list

## Decision

Build the tag-input combobox on the existing `command.tsx` (cmdk) wrapper inside `popover.tsx` (Radix). The new `apps/web/components/vault/tag-combobox.tsx` wraps these with an EXPLICIT a11y contract:

- **Root:** `<div role="combobox" aria-haspopup="listbox" aria-expanded aria-controls>`.
- **Input:** plain `<input aria-autocomplete="list" aria-controls aria-activedescendant>`. NOT cmdk's `CommandInput` — the wrapper input owns the combobox role/aria.
- **List:** wrap `CommandList` with `role="listbox"`.
- **Multi-select popover persistence:** `onSelect` appends to value; popover does NOT close on select. Closes on outside-click or Escape only.
- **Create-new affordance:** detect `inputValue.trim()` not in suggestions → render synthetic top-of-list `CommandItem` (key=`__create__`). Enter binds to it on no-match.
- **No `CommandSeparator`** — verified cmdk wrapper at `apps/web/components/ui/command.tsx` does not export it. Inline a styled `<div>` if needed.

## Decision drivers

- **Bundle ceiling 170 kB on `/vault`.** Adding a new Radix package costs ~5-8 kB gz before any feature code. EPIC-9 baseline was 169 kB — 1 kB of headroom.
- **Radix surface freeze (EPIC-9 ADR B2).** A new primitive forces ALLOWED-list bump + ADR — extra ceremony for no UX gain.
- **cmdk + popover already on ALLOWED list.** Free reuse, plus cmdk's `CommandList` virtualization handles large tag corpora.
- **No other combobox primitive in repo.** Building on `<input list>`+`<datalist>` loses the create-new affordance and the visual consistency with the existing command palette.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| `@radix-ui/react-combobox` | Built-in combobox a11y, no wrapper contract needed | New package = ALLOWED-list bump + ~5-8 kB gz bundle hit; ADR-EPIC10-002 + ADR-EPIC10-004 needed |
| `@radix-ui/react-popover` + bespoke `<input role=combobox>` + hand-rolled list | Full a11y control, no cmdk dep | Hand-rolled list = no virtualization, more code, more test surface |
| `<input list>` + `<datalist>` | Zero new deps | No "create new" affordance, inconsistent visuals across browsers, no virtualization, weak a11y |

## Why chosen

Real bundle saving (cmdk already chunked in the command palette). The a11y mismatch between cmdk's defaults and combobox role is fully recoverable via the wrapper contract, which is enforced as a Phase 3 acceptance gate AND a vitest assertion. Adding a new Radix primitive would force ALLOWED-list bump for zero UX gain.

## Consequences

- `tag-combobox.tsx` is responsible for a11y correctness; wrapper-level test (vitest) asserts roles.
- `scripts/grep_radix_surface.sh` ALLOWED list NOT updated.
- Future combobox usage (e.g., EPIC-11's inspiration flag UI) should reuse `tag-combobox.tsx` semantics or extend its wrapper, not introduce a different combobox library.

## Follow-ups

- If cmdk's API drifts and breaks the wrapper contract, reassess `@radix-ui/react-combobox` in a future EPIC.
