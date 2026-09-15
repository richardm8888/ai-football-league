# Deploying

Merging a pull request into `main` deploys to the droplet. Nothing else needs
doing.

```
merge to main
  → CI              type-check and the full suite
  → Publish image   builds the image, tags it with the commit
  → Deploy          SSHes in, migrates, swaps the container, checks health
```

Each step gates the next as a job dependency, so there is no path from a
failing test to a running container. A pull request runs CI on its own and
stops there.

The commit is the unit of deployment. Every image is tagged with its SHA, the
droplet's `.env` pins `TAG` to that SHA, and rolling back is deploying an
earlier one. `latest` exists and only ever moves on `main`.

The database is **DigitalOcean managed Postgres**, not a container. Nothing on
the droplet stores data, so losing the box costs an afternoon rather than the
league.

## One-time setup

### 1. The database

DigitalOcean → **Databases** → Create → PostgreSQL 16, in the same region as
the droplet.

Once it is up:

1. **Make a database for the app.** The cluster ships with `defaultdb`. Under
   **Users & Databases**, add one called `aifl`. Using `defaultdb` works and
   makes it harder to tell later what is safe to drop.

2. **Let the droplet in.** Settings → **Trusted sources** → add the droplet.
   Until you do, every connection is refused, and the symptom is a deploy that
   fails at the migration step with a timeout rather than anything mentioning
   permissions.

3. **Take the connection string.** Connection details → *Connection string*,
   with `aifl` selected as the database. If the droplet and the cluster share a
   region, switch the dropdown to **Private network** — traffic then stays on
   DigitalOcean's internal network instead of crossing the public internet, and
   it does not count against bandwidth.

The string looks like this, and the parts that are easy to get wrong are the
port and the SSL mode:

```
postgresql://doadmin:PASSWORD@private-db-postgresql-lon1-00000-do-user-000000-0.l.db.ondigitalocean.com:25060/aifl?sslmode=require&connection_limit=5
```

`connection_limit` is worth adding. Managed clusters cap connections — 22 on
the smallest plan, shared with anything else that connects — and Prisma's
default pool size is based on the container's CPU count, which can exhaust that
on its own.

**If you use one of DigitalOcean's connection pools, give it session mode.**
Prisma's migrations need a session-scoped connection and fail against a
transaction-mode pooler. A direct connection is simpler and is what the
`connection_limit` above is for.

### 2. What `<user>` and `<droplet-ip>` are

Both are what you already use to get into the droplet.

- **`<droplet-ip>`** — DigitalOcean → Droplets, beside the droplet's name. From
  on the droplet: `curl -4 ifconfig.me`.
- **`<user>`** — whoever you are when you SSH in. On a stock droplet that is
  `root`. From on the droplet: `whoami`.

If `ssh <user>@<droplet-ip>` works, those are the two values. Deploying as
`root` is fine here: it is one box running one app, and a separate deploy user
buys little against the chance of locking yourself out mid-setup.

### 3. A key for GitHub to use

Your own key would work. Giving GitHub its own buys one thing — revoking its
access without revoking yours — and it is cheap.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/aifl-deploy -C 'github-deploy' -N ''
```

**`ssh-copy-id` will not work on a stock DigitalOcean droplet**: it needs an
existing way in, and these ship with `PasswordAuthentication no`. Pick whichever
is true:

- **You can already SSH in** — carry the new key over that way:

  ```bash
  cat ~/.ssh/aifl-deploy.pub | ssh <user>@<droplet-ip> 'cat >> ~/.ssh/authorized_keys'
  ```

- **You generated it on the droplet** — no SSH involved:

  ```bash
  cat ~/.ssh/aifl-deploy.pub >> ~/.ssh/authorized_keys
  ```

- **You cannot get in at all** — DigitalOcean → droplet → **Console**, which
  needs no key, and paste it in:

  ```bash
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  echo 'ssh-ed25519 AAAA... github-deploy' >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  ```

Then check it from the machine holding the private key. A key that was never
installed surfaces much later as an unhelpful "Permission denied" inside a
GitHub Action:

```bash
ssh -i ~/.ssh/aifl-deploy <user>@<droplet-ip> 'whoami && docker ps'
```

### 4. The droplet

Docker has to run without `sudo`. As `root` it already does; any other user
needs adding to the group:

```bash
sudo usermod -aG docker <user>   # log out and back in for it to take
```

The deploy moves the checkout to the commit being deployed, so the repository
has to be there:

```bash
sudo git clone https://github.com/richardm8888/ai-football-league /opt/ai-football-league
sudo chown -R <user>:<user> /opt/ai-football-league
cd /opt/ai-football-league
cp .env.example .env
```

Then edit `.env`. These four matter:

```
APP_IMAGE=ghcr.io/richardm8888/ai-football-league
DATABASE_URL=postgresql://doadmin:...:25060/aifl?sslmode=require&connection_limit=5
SESSION_SECRET=<openssl rand -hex 32>
ANTHROPIC_API_KEY=          # leave empty to run the local coach
```

Leave `TAG` alone — deploys rewrite it.

`DATABASE_URL` lives here and never travels through CI. GitHub needs SSH access
to the box; it has no business holding the database password as well.

Create the schema once, before the first deploy:

```bash
docker compose -f docker-compose.prod.yml run --rm app node node_modules/prisma/build/index.js migrate deploy
```

That is also the command that tells you whether trusted sources are set up
correctly, and it is much easier to read here than inside a workflow log.

### 5. Repository secrets

**Settings → Secrets and variables → Actions → Secrets:**

| Secret | Value |
| --- | --- |
| `SSH_HOST` | droplet IP or hostname |
| `SSH_USER` | the user you copied the key to |
| `SSH_PRIVATE_KEY` | contents of `~/.ssh/aifl-deploy` — the whole file, `BEGIN`/`END` lines included |

**→ Variables** (optional):

| Variable | Default | Value |
| --- | --- | --- |
| `DEPLOY_PATH` | `/opt/ai-football-league` | where the repo is checked out on the droplet |
| `APP_URL` | — | shown as a link on the deployment in GitHub |

No registry credentials are stored on the droplet. The workflow passes a token
scoped to this repository that expires with the job.

### 6. Check it before trusting it

Actions → Deploy → Run workflow, leaving the commit box empty. It deploys the
tip of `main`, which is what is already running, so a mistake in the setup
shows up while nothing is changing.

## What a deploy does

1. **Moves the checkout** to the commit, so the compose file and the migrations
   match the image.
2. **Pulls**, before anything running is touched — a registry problem should
   fail while the old container is still serving.
3. **Migrates**, in a throwaway container on the *new* image, *before* the new
   app starts. The other order leaves a window where new code queries columns
   that do not exist yet, which is a 500 to whoever is browsing. This is also
   the first thing to touch the cluster, so an unreachable database fails here
   with the old build still up.
4. **Swaps the container.**
5. **Waits for health**, up to two and a half minutes. Two signals have to
   agree: Docker reports the container healthy, and `/api/health` answers on
   the published port. That endpoint runs a real query, so it distinguishes an
   app that started from an app that works — a container serving pages while
   Prisma cannot reach the cluster is a dead site, and it is the failure this
   exists to catch.
6. **Rolls back on its own** if that fails: puts `TAG` back, restarts the
   previous image (still on disk, so this works even when the registry is the
   problem) and waits for health again. If the rollback is also unhealthy it
   says so loudly, because at that point it needs a person.
7. **Prunes images** older than a week. A full disk fails the next deploy in a
   way that looks like something else entirely.
8. **Prints `DEPLOY-COMPLETE <sha>`**, and the workflow fails if that line is
   missing.

### Why step 8 exists

An exit code cannot tell a finished deploy from one that stopped early and
happened to end on a successful command.

The specific way that happens: if the deploy script is piped into `bash -s`
over SSH, the script itself is bash's standard input, and `docker compose run`
attaches stdin by default — so the migration step reads the rest of the script
as container input. Bash then hits end-of-file and exits 0, after migrating but
before swapping anything. The droplet keeps serving the previous build and
every deploy reports success.

Three things stop it. The script is written to a file on the droplet and run
from there, so nothing is on stdin to eat. The migration runs with `-T` and
`< /dev/null`, so it could not eat it anyway. And the completion line is
printed last, so a deploy that stops early cannot look successful.

**If you are ever unsure whether a deploy landed**, read the log rather than
trusting the green tick. It ends with `==> Deployed <sha>` followed by
`DEPLOY-COMPLETE <sha>`. Anything shorter means the container may still be
running the previous build.

## Deploying something else

**Roll back, or ship a specific commit:** Actions → Deploy → Run workflow →
paste the commit. Manual runs skip the "was the build green" check, which is
deliberate: that check is what would stop you shipping a known-good commit
during an incident.

**By hand on the droplet**, if GitHub is unavailable:

```bash
cd /opt/ai-football-league
./deploy/deploy.sh <sha>
```

Same script, same steps, same rollback. Without a token it uses whatever
`docker login` the box already has.

## Things worth knowing

**A rollback rolls back code, not data.** A migration that dropped a column is
not undone by deploying the previous image, and the older code may not expect
what it finds. Take a snapshot from the cluster's Backups tab before anything
destructive; managed Postgres does daily backups and point-in-time restore, but
neither helps if nobody checked before running the migration.

**Deploys queue rather than cancel.** Two merges in quick succession deploy in
order. Cancelling would risk interrupting a migration, and would let a merge
cancel the deploy of the merge before it and leave that commit unshipped.

**There is one droplet and no staging.** CI runs the tests on every pull
request, so a red build never becomes a deploy, but the first place any merge
runs for real is production.

**Nothing terminates TLS yet.** The container publishes port 3000 on all
interfaces. Put a reverse proxy in front of it for anything public, then set
`APP_BIND=127.0.0.1` in `.env` so the container is only reachable through it.

**The seed script is for development.** `npm run db:seed` creates a league of
fictional clubs with known passwords. Do not point it at the managed cluster
unless that is genuinely what you want.
