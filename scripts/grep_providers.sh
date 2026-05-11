#!/usr/bin/env bash
# scripts/grep_providers.sh — fail CI if vendor names leak outside allowed paths
#
# Vendor names must appear ONLY in:
#   services/providers/   config.yaml.example   tests/   apps/web/messages/
#   docs/                 README.md              .git/    node_modules/
#   .next/                .venv/                 dist/    .omc/
#   demo/                 .github/               .pre-commit-config.yaml
#
# Usage:
#   bash scripts/grep_providers.sh
#   make grep-providers

set -euo pipefail

VENDOR_PATTERN='openai|anthropic|apimart|fireworks|fal\.ai|bedrock|vertex|gpt-image|claude(-)?( sonnet| haiku| opus)?|gemini|qwen|dashscope|nemotron'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Build the exclusion list for grep
EXCLUDES=(
    "--exclude-dir=.git"
    "--exclude-dir=node_modules"
    "--exclude-dir=.next"
    "--exclude-dir=.venv"
    "--exclude-dir=dist"
    "--exclude-dir=.omc"
    "--exclude-dir=demo"
    "--exclude-dir=.github"
    "--exclude-dir=docs"
    "--exclude-dir=tests"
    "--exclude-dir=services"   # will search selectively below
    "--exclude-dir=apps"       # will search selectively below
    "--exclude=.pre-commit-config.yaml"
    "--exclude=README.md"
    "--exclude=config.yaml.example"
    "--exclude=*.md"
)

# We scan the whole repo then filter out the allowlisted paths
# Use python-based search to avoid the bun/grep flag collision
export REPO_ROOT
HITS=$(python3 - <<'PYEOF'
import os
import re
import sys

# REPO_ROOT passed in from bash — deterministic, does not depend on cwd or __file__
repo_root = os.environ["REPO_ROOT"]

# Allowlisted path prefixes (relative to repo root)
ALLOWLIST_PREFIXES = (
    os.path.join(repo_root, 'services', 'providers'),
    os.path.join(repo_root, 'tests'),
    os.path.join(repo_root, 'apps', 'web', 'messages'),
    os.path.join(repo_root, 'docs'),
    os.path.join(repo_root, 'demo'),
    os.path.join(repo_root, '.git'),
    os.path.join(repo_root, 'node_modules'),
    os.path.join(repo_root, '.next'),
    os.path.join(repo_root, '.venv'),
    os.path.join(repo_root, 'dist'),
    os.path.join(repo_root, '.omc'),
    os.path.join(repo_root, '.github'),
    os.path.join(repo_root, '.pytest_cache'),
    os.path.join(repo_root, '.ruff_cache'),
    os.path.join(repo_root, '.mypy_cache'),
    os.path.join(repo_root, 'fixtures'),
)
ALLOWLIST_FILES = (
    os.path.join(repo_root, 'config.yaml.example'),
    os.path.join(repo_root, '.env.example'),
    os.path.join(repo_root, 'README.md'),
    os.path.join(repo_root, '.pre-commit-config.yaml'),
    os.path.join(repo_root, 'scripts', 'grep_providers.sh'),
)

# Vendor name regex. Notes:
#   - `openai_compatible` and `anthropic_compatible` are PROTOCOL family names
#     (the two-protocol abstraction), NOT vendor names. They are explicitly
#     allowed everywhere. Post-match filter skips any hit followed by `_compatible`.
#   - Match is case-insensitive but anchored on word-ish boundaries.
VENDOR_RE = re.compile(
    r'openai|anthropic|apimart|fireworks|fal\.ai|bedrock|vertex|gpt-image'
    r'|claude(-\s*)?(sonnet|haiku|opus)?'
    r'|gemini|qwen|dashscope|nemotron',
    re.IGNORECASE,
)
PROTOCOL_SUFFIX_RE = re.compile(r'_compatible\b', re.IGNORECASE)

COMMENT_LINE_RE = re.compile(r'^\s*(?:#|//|\*)')

SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.ico', '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.bin', '.pyc',
    '.lock', '.sum',
}

# Directory names that are pruned wherever they appear in the tree (including
# nested locations like `apps/web/.next/` or `apps/web/.omc/`). These directories
# are generated artifacts, dependency caches, or session state — never source.
PRUNE_DIR_NAMES = {
    '.git', 'node_modules', '.next', '.omc', '.venv', 'dist', '.github',
    '.pytest_cache', '.ruff_cache', '.mypy_cache', '__pycache__', '.turbo',
    '.cache',
}

hits = []

for dirpath, dirnames, filenames in os.walk(repo_root):
    # Prune allowlisted dirs in-place — by name (any depth) OR by absolute prefix
    dirnames[:] = [
        d for d in dirnames
        if d not in PRUNE_DIR_NAMES
        and not any(
            os.path.join(dirpath, d).startswith(p)
            for p in ALLOWLIST_PREFIXES
        )
    ]
    for filename in filenames:
        filepath = os.path.join(dirpath, filename)
        # Skip allowlisted files
        if filepath in ALLOWLIST_FILES:
            continue
        if any(filepath.startswith(p) for p in ALLOWLIST_PREFIXES):
            continue
        # Skip binary extensions
        _, ext = os.path.splitext(filename)
        if ext.lower() in SKIP_EXTENSIONS:
            continue
        try:
            with open(filepath, encoding='utf-8', errors='ignore') as fh:
                for lineno, line in enumerate(fh, 1):
                    # Skip comment lines
                    if COMMENT_LINE_RE.match(line):
                        continue
                    for m in VENDOR_RE.finditer(line):
                        # Skip if this match is the prefix of a protocol family
                        # name like `openai_compatible` / `anthropic_compatible`
                        tail = line[m.end():m.end() + 12]
                        if PROTOCOL_SUFFIX_RE.match(tail):
                            continue
                        rel = os.path.relpath(filepath, repo_root)
                        hits.append(f"{rel}:{lineno}:{m.group()}")
                        break  # one hit per line is enough for reporting
        except (OSError, PermissionError):
            continue

for h in hits:
    print(h)
PYEOF
)

if [ -n "$HITS" ]; then
    echo "--- grep-providers: VENDOR LEAK DETECTED ---" >&2
    echo "$HITS" >&2
    echo "---" >&2
    echo "Fix: vendor names belong only in services/providers/, config.yaml.example, tests/, docs/" >&2
    exit 1
fi

echo "grep-providers: clean — no vendor names leaked outside allowed paths"
exit 0
