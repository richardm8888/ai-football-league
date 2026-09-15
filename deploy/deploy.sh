#!/usr/bin/env bash
#
# Deploys a commit to this host.
#
# Runs on the droplet. The deploy workflow sends it over SSH so it never
# depends on what the droplet already has checked out — which matters most
# when that checkout is the thing that is broken. It can also be run by hand:
#
#   ./deploy/deploy.sh <sha>
#
# The commit is the unit of deployment, not `latest`. A tag that moves is fine
# when a human is watching and wrong when nothing is: pinning means the running
# code can be named, and rolling back is deploying the previous name again.

set -euo pipefail

SHA="${1:?usage: deploy.sh <commit-sha>}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/ai-football-league}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

# The droplet runs the production file: one container, no database of its own.
# Postgres is the managed DigitalOcean cluster named by DATABASE_URL in .env.
COMPOSE=(docker compose -f docker-compose.prod.yml)

cd "$DEPLOY_PATH"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# The compose file and the migrations live in the repository, so the checkout
# has to move before anything else does, or the containers are swapped using a
# compose file that does not describe them.
git fetch --quiet origin
git checkout --quiet --detach "$SHA"

# Whatever is running now, so a failed deploy has somewhere to go back to.
PREVIOUS="$(grep -E '^TAG=' .env 2>/dev/null | cut -d= -f2- || true)"
PREVIOUS="${PREVIOUS:-latest}"

set_tag() {
    # Written into .env rather than exported, so a compose command typed by
    # hand on this box later starts the same code that is running now.
    if grep -qE '^TAG=' .env; then
        sed -i "s|^TAG=.*|TAG=$1|" .env
    else
        printf 'TAG=%s\n' "$1" >> .env
    fi
}

health_ok() {
    # Two signals, because either alone lies.
    #
    # Docker's healthcheck runs /api/health inside the container, which proves
    # the app is serving and can reach Postgres — but says nothing about
    # whether anything outside the container can reach it. Fetching the same
    # endpoint on the published port proves the rest of the path.
    local id port
    id="$("${COMPOSE[@]}" ps -q app 2>/dev/null || true)"

    [ -n "$id" ] || return 1
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = 'healthy' ] || return 1

    port="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2- || true)"
    port="${port:-3000}"

    # -f so a 503 from the health route counts as unhealthy rather than as a
    # page successfully fetched.
    curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${port}/api/health" || return 1
}

wait_for_health() {
    for _ in $(seq 1 "$HEALTH_RETRIES"); do
        if health_ok; then
            return 0
        fi
        sleep "$HEALTH_INTERVAL"
    done

    return 1
}

roll_back() {
    say "Deploy failed — rolling back to $PREVIOUS"
    set_tag "$PREVIOUS"

    # The previous image is still on disk, so this needs no registry and works
    # even when the registry is why the deploy failed.
    "${COMPOSE[@]}" up -d --no-build --remove-orphans

    if wait_for_health; then
        echo "Rolled back and healthy. The league is up on the previous build."
    else
        echo "ROLLBACK FAILED — the site is down and needs a human." >&2
    fi

    # A rollback restores code, not data. A migration that dropped a column is
    # still applied, and the previous build may not expect that.
    echo "Note: database migrations are not rolled back." >&2

    exit 1
}

say "Deploying $SHA"
set_tag "$SHA"

# The workflow passes a token scoped to this repository and valid only for the
# length of the job, so nothing long-lived is stored on the droplet. Run by
# hand there is no token, and whatever `docker login` the box already has is
# used instead.
if [ -n "${REGISTRY_TOKEN:-}" ]; then
    printf '%s' "$REGISTRY_TOKEN" \
        | docker login ghcr.io -u "${REGISTRY_USER:-x}" --password-stdin > /dev/null
fi

# Pull before touching anything running: a registry problem should fail while
# the old container is still serving.
say "Pulling image"
"${COMPOSE[@]}" pull --quiet

# Migrations run in a throwaway container on the new image, before the new app
# starts. The other way round leaves a window where new code queries columns
# that do not exist yet, which is a 500 to whoever is browsing.
#
# This is also the first thing to touch the managed cluster, so an unreachable
# database — a droplet missing from the cluster's trusted sources, most
# likely — fails here, with the old build still serving, rather than as a
# container that starts and cannot answer.
say "Running migrations"
# -T and </dev/null: `docker compose run` attaches stdin by default. If this
# script were ever on stdin, the migration would read the rest of it as
# container input, and everything below this line would silently not happen.
# The workflow writes the script to a file for the same reason; this is the
# second lock on that door.
if ! "${COMPOSE[@]}" run --rm -T app node node_modules/prisma/build/index.js migrate deploy < /dev/null; then
    say "Migration failed — nothing has been swapped, the old build is still serving"
    set_tag "$PREVIOUS"
    exit 1
fi

say "Starting the container"
"${COMPOSE[@]}" up -d --no-build --remove-orphans

say "Waiting for health"
wait_for_health || roll_back

# Images accumulate quickly on a small droplet, and a full disk fails the next
# deploy in a way that looks like something else entirely.
say "Cleaning up old images"
docker image prune -f --filter "until=168h" > /dev/null || true

say "Deployed $SHA"

# Proof that the script ran to the end. A deploy that stops early — for any
# reason — must fail loudly rather than report success on the strength of an
# exit code from wherever it stopped. The workflow greps for this exact line.
echo "DEPLOY-COMPLETE $SHA"
