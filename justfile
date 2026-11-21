# Commands are grouped by environment, and they work from anywhere in the repo:
# `just local` lists local development (local/justfile), `just aws` the web
# evaluator in AgentCore (aws/justfile).
mod local
mod aws

# Deploys and releases run as GitHub Actions in this personal repo, a copy of main from
# the organization repo (see infra/README.md). Every team member is a collaborator there.
personal_repo := "brayanmoreno/hackathon-grupo36"

[private]
[default]
help:
    @just --list --list-submodules --unsorted

# Copies main and the tags to the personal repo now, and follows the deploy if one starts
[group('GitHub')]
sync: _gh
    #!/usr/bin/env bash
    set -euo pipefail
    since="$(node -p 'new Date(Date.now() - 30000).toISOString().slice(0, 19) + "Z"')"
    # run_since WORKFLOW EVENT: id of the newest run of WORKFLOW for EVENT created after $since.
    run_since() {
        gh run list -R {{ personal_repo }} --workflow "$1" --event "$2" --limit 5 --json databaseId,createdAt \
            --jq "[.[] | select(.createdAt >= \"$since\")] | first | .databaseId // empty"
    }

    gh workflow run sync-desde-org.yml -R {{ personal_repo }} > /dev/null
    echo "Syncing the personal repo…"
    id=""
    for _ in $(seq 20); do id="$(run_since sync-desde-org.yml workflow_dispatch)"; [ -n "$id" ] && break; sleep 2; done
    [ -n "$id" ] || { echo "  ✘ The sync run did not show up. Check the Actions tab of {{ personal_repo }}." >&2; exit 1; }
    if ! gh run watch "$id" -R {{ personal_repo }} --exit-status --interval 3 > /dev/null; then
        echo "  ✘ The sync failed:" >&2
        gh run view "$id" -R {{ personal_repo }} --log-failed | tail -n 15 >&2
        exit 1
    fi
    echo "  ✔ The personal repo is at $(gh api repos/{{ personal_repo }}/commits/main --jq '.sha[0:7]'), same as main"

    # A push starts the deploys within seconds: Terraform if it touches backend/ or infra/app/,
    # AgentCore if it touches the web evaluator (agents/). Prints "workflow id" for each one.
    deploys_since() {
        for workflow in terraform.yml agentcore.yml; do
            id="$(run_since "$workflow" push)"
            [ -z "$id" ] || echo "$workflow $id"
        done
    }
    deploys=""
    for _ in $(seq 8); do deploys="$(deploys_since)"; [ -n "$deploys" ] && break; sleep 2; done
    # Both start from the same push: give the second one a moment to show up.
    [ -z "$deploys" ] || { sleep 3; deploys="$(deploys_since)"; }
    if [ -z "$deploys" ]; then
        echo "  ✔ Nothing to deploy: no changes in backend/, infra/app/ or the web evaluator"
        exit 0
    fi
    failed=0
    while read -r workflow deploy; do
        echo "Deploying to AWS with ${workflow%.yml}… (https://github.com/{{ personal_repo }}/actions/runs/$deploy)"
        if gh run watch "$deploy" -R {{ personal_repo }} --exit-status --interval 5 > /dev/null < /dev/null; then
            echo "  ✔ Deployed"
        else
            echo "  ✘ The deploy failed:" >&2
            gh run view "$deploy" -R {{ personal_repo }} --log-failed < /dev/null | tail -n 20 >&2
            failed=1
        fi
    done <<< "$deploys"
    exit "$failed"

# Publishes a signed version of the extension from main, e.g. just publish v0.3.0
[group('GitHub')]
publish version: _gh
    #!/usr/bin/env bash
    set -euo pipefail
    tag="{{ version }}"
    [[ "$tag" == v* ]] || tag="v$tag"
    if ! [[ "$tag" =~ ^v(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8})){2}$ ]]; then
        echo "  ✘ The version must look like v0.3.0 (got \"{{ version }}\")." >&2
        exit 1
    fi

    git fetch -q --tags origin main
    if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
        echo "  ✘ $tag already exists. Mozilla never signs the same version twice: pick a higher one." >&2
        exit 1
    fi
    latest="$(git tag -l 'v*' --sort=-v:refname | head -n 1)"
    if [ -n "$latest" ] && [ "$(printf '%s\n%s\n' "$latest" "$tag" | sort -V | tail -n 1)" != "$tag" ]; then
        echo "  ✘ $tag must be higher than the last published version, $latest." >&2
        exit 1
    fi

    since="$(node -p 'new Date(Date.now() - 30000).toISOString().slice(0, 19) + "Z"')"
    # The tag goes on main as it is on GitHub, not on whatever is checked out here.
    git tag "$tag" origin/main
    if ! git push -q origin "refs/tags/$tag"; then
        git tag -d "$tag" > /dev/null
        echo "  ✘ Could not push $tag to origin." >&2
        exit 1
    fi
    # Straight to the personal repo too, so publishing doesn't wait for the scheduled sync.
    case "$(git remote get-url origin)" in
        git@*) personal="git@github.com:{{ personal_repo }}.git" ;;
        *)     personal="https://github.com/{{ personal_repo }}.git" ;;
    esac
    git push -q "$personal" "refs/tags/$tag"
    echo "Publishing $tag ($(git rev-parse --short "$tag"), main)… Mozilla takes a few minutes to sign it."

    id=""
    for _ in $(seq 20); do
        id="$(gh run list -R {{ personal_repo }} --workflow publicar-extension.yml --event push --limit 5 \
            --json databaseId,createdAt,headBranch \
            --jq "[.[] | select(.headBranch == \"$tag\" and .createdAt >= \"$since\")] | first | .databaseId // empty")"
        [ -n "$id" ] && break
        sleep 2
    done
    [ -n "$id" ] || { echo "  ✘ The publish run did not show up. Check the Actions tab of {{ personal_repo }}." >&2; exit 1; }
    echo "  (https://github.com/{{ personal_repo }}/actions/runs/$id)"
    if ! gh run watch "$id" -R {{ personal_repo }} --exit-status --interval 10 > /dev/null; then
        echo "  ✘ Publishing failed:" >&2
        gh run view "$id" -R {{ personal_repo }} --log-failed | tail -n 20 >&2
        echo "If it failed after reaching Mozilla, publish the next version instead of reusing $tag." >&2
        exit 1
    fi
    echo "  ✔ Published: https://github.com/{{ personal_repo }}/releases/tag/$tag"

# Checks that gh is logged in and can see the personal repo
[private]
_gh:
    @command -v gh > /dev/null || { echo "  ✘ Missing gh, the GitHub CLI → brew install gh" >&2; exit 1; }
    @gh auth status > /dev/null 2>&1 || { echo "  ✘ gh is not logged in → gh auth login" >&2; exit 1; }
    @gh api repos/{{ personal_repo }} --silent 2> /dev/null || { echo "  ✘ No access to {{ personal_repo }}: ask Brayan to add you as a collaborator." >&2; exit 1; }
