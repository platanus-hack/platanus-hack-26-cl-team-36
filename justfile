# Project commands. Run them from the repo root, in this order:
#
#   1. just setup                      once, after cloning
#   2. just dev                        backend + Firefox with the extension
#   3. just test                       before pushing
#   4. just explore <url> "<task>"     synthetic users (calls Claude)

list_heading := "Run these in order:\n"

# First recipe, so `just` alone runs it too.
[private]
help:
    @just --list --unsorted --list-heading '{{ list_heading }}'

# ── 1. Setup ──────────────────────────────────────────────────────────────

# Checks requirements and installs all dependencies (safe to re-run)
[group('1. Setup · once, after cloning')]
setup:
    #!/usr/bin/env bash
    set -uo pipefail
    missing=0
    ok()   { echo "  ✔ $1"; }
    fail() { echo "  ✘ $1 → $2"; missing=$((missing + 1)); }

    echo "Checking requirements"
    if command -v node >/dev/null && command -v npm >/dev/null \
        && node -e 'process.exit(parseInt(process.versions.node) < 22 ? 1 : 0)'; then
        ok "Node.js $(node --version) and npm"
    else
        fail "Node.js 22 or newer, with npm" "brew install node"
    fi
    if [ -x /Applications/Firefox.app/Contents/MacOS/firefox ]; then
        ok "Firefox"
    else
        fail "Firefox" "brew install --cask firefox"
    fi
    if ! command -v uv >/dev/null && command -v brew >/dev/null; then
        brew install uv
    fi
    if command -v uv >/dev/null; then
        ok "uv"
    else
        fail "uv" "https://docs.astral.sh/uv/"
    fi
    # Only step 4 needs Claude Code, so it warns instead of stopping the setup.
    if ! command -v claude >/dev/null; then
        echo "  ! Claude Code is missing (needed for step 4) → https://claude.com/claude-code"
    elif claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
        ok "Claude Code, logged in"
    else
        echo "  ! Claude Code is not logged in (needed for step 4) → claude auth login"
    fi
    if [ "$missing" -gt 0 ]; then
        echo "Fix the ✘ items and run \`just setup\` again."
        exit 1
    fi

    set -e
    echo "Installing dependencies"
    npm install    # the root postinstall also installs extension/ (web-ext)
    cd agents/app/web_evaluator
    uv sync
    uv run playwright install chromium
    echo "Done. Next: \`just dev\`"

# ── 2. Run ────────────────────────────────────────────────────────────────

# Starts the backend (localhost:4747) and opens a separate Firefox with the extension; Ctrl+C stops both
[group('2. Run')]
dev: _ready
    #!/usr/bin/env bash
    set -euo pipefail
    (cd backend && exec node --watch index.js) &
    backend=$!
    trap 'kill "$backend" 2>/dev/null || true' EXIT
    npm --prefix extension run dev || [ $? -eq 130 ]    # 130 = stopped with Ctrl+C, not an error

# ── 3. Test ───────────────────────────────────────────────────────────────

# Backend and extension tests, extension lint and web_evaluator tests; does not call Claude
[group('3. Test · before pushing')]
test: _ready
    npm run check
    cd agents/app/web_evaluator && uv run pytest -q

# ── 4. Synthetic users ────────────────────────────────────────────────────

# Synthetic users try a task on a URL. E.g. just explore https://example.cl "Find the opening hours" --profiles mobile
[group('4. Synthetic users · calls Claude, uses your plan')]
[working-directory('agents/app/web_evaluator')]
[positional-arguments]
explore url task *options: _ready
    #!/usr/bin/env bash
    set -euo pipefail
    url="$1" task="$2"
    shift 2
    exec uv run main.py --url "$url" --instruction "$task" ${1+"$@"}

# Runs the reference tasks in agents/tasks/ in parallel: all, or the ones whose id starts with wom, sii or dt
[group('4. Synthetic users · calls Claude, uses your plan')]
[working-directory('agents/app/web_evaluator')]
[positional-arguments]
validate task="all" *options: _ready
    #!/usr/bin/env bash
    set -euo pipefail
    prefix="${1:-all}"
    [ $# -gt 0 ] && shift
    [ "$prefix" = all ] && prefix=""
    ids=()
    for f in ../../tasks/"$prefix"*.json; do
        [ -e "$f" ] && ids+=("$(basename "$f" .json)")
    done
    if [ ${#ids[@]} -eq 0 ]; then
        echo "error: no task in agents/tasks/ starts with '$prefix'" >&2
        exit 1
    fi

    # Each task writes to agents/.runs/<id>/, so parallel runs don't collide.
    pids=()
    for id in "${ids[@]}"; do
        uv run main.py --task "$id" ${1+"$@"} 2>&1 | sed -u "s/^/[$id] /" &
        pids+=($!)
    done
    failures=0
    for pid in "${pids[@]}"; do wait "$pid" || failures=$((failures + 1)); done
    [ "$failures" -eq 0 ]

[private]
_ready:
    @test -x extension/node_modules/.bin/web-ext -a -x agents/app/web_evaluator/.venv/bin/python \
        || { echo "Dependencies are missing: run \`just setup\` first." >&2; exit 1; }
