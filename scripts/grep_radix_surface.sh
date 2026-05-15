#!/usr/bin/env bash
# EPIC-9 Architect B2 drift-guard.
#
# Asserts that apps/web/components/ui/ contains only the documented Radix
# wrappers.  A future PR that adds Sheet/Drawer/etc. (or any other new
# surface) will fail this check and force the author to either justify the
# new dependency (update ALLOWED below) or extend an existing wrapper.
#
# Parallel to scripts/grep_providers.sh.

set -euo pipefail

UI_DIR="apps/web/components/ui"
ALLOWED=(
  "button.tsx"
  "command.tsx"
  "dialog.tsx"
  "dropdown-menu.tsx"
  "popover.tsx"
  "tooltip.tsx"
)

if [[ ! -d "$UI_DIR" ]]; then
  echo "grep-radix-surface: $UI_DIR not found (run from repo root)" >&2
  exit 2
fi

# shellcheck disable=SC2207
actual=($(/usr/bin/ls "$UI_DIR" | sort))
expected=($(printf '%s\n' "${ALLOWED[@]}" | sort))

if [[ "${actual[*]}" != "${expected[*]}" ]]; then
  echo "grep-radix-surface: UI surface drift detected." >&2
  echo "  expected: ${expected[*]}" >&2
  echo "  actual:   ${actual[*]}" >&2
  echo "" >&2
  echo "  If you intentionally added a new Radix wrapper, update the ALLOWED" >&2
  echo "  list in scripts/grep_radix_surface.sh and document the decision." >&2
  exit 1
fi

echo "grep-radix-surface: $UI_DIR matches expected surface (${#expected[@]} files)."
