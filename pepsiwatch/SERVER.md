# PepsiWatch scraper — server deployment guide

Goal: run the PepsiWatch price scraper in a Docker container on this server so it
pushes fresh `pepsiwatch/prices.json` to GitHub every 6 hours. GitHub Actions can't do
it (Coles/Woolworths/Amazon block datacenter IPs), so it has to run from here.

Everything needed is already in the repo under `pepsiwatch/`:
`Dockerfile`, `run.sh`, `docker-compose.yml`, `fetch.py`, `.env.example`.

## How it works
- The container clones `SighMonIs/PrintDesk` on start (using a GitHub token), then loops:
  `git pull` → `python3 fetch.py` (scrapes via curl, writes `prices.json`) → commit → push → sleep `INTERVAL`.
- `fetch.py` comes from the clone, so scraper changes in git need no image rebuild — just restart the container.
- One store failing keeps its last-known rows; the page shows an "unreachable" note.

## Steps

1. Get the files (only the `pepsiwatch` folder is needed):
   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/SighMonIs/PrintDesk.git
   cd PrintDesk && git sparse-checkout set pepsiwatch && cd pepsiwatch
   ```

2. Create `.env` next to `docker-compose.yml`:
   ```
   GITHUB_TOKEN=github_pat_...
   ```
   The token must be supplied by Simon (do not generate or guess one). It is a
   fine-grained PAT scoped to the `PrintDesk` repo with **Contents: Read and write**.
   Created at: https://github.com/settings/personal-access-tokens/new

3. Build and start:
   ```bash
   docker compose up -d --build
   ```

4. Verify:
   ```bash
   docker compose logs -f
   ```
   Expect `N rows, errors={}` then `pushed <timestamp>` within a minute or two.
   Then check https://github.com/SighMonIs/PrintDesk/commits/main for a
   "pepsiwatch: update prices" commit and https://www.simonreid.space/pepsiwatch
   for a fresh "Updated" time with no red "unreachable" note.

## Tuning
- Interval: edit `INTERVAL` in `docker-compose.yml` (e.g. `3h`, `30m`), then `docker compose up -d`.
- If a store is consistently blocked from this server's IP, it will show as
  unreachable on the page while the others keep updating — report which one.
- Test the scraper by hand without pushing:
  ```bash
  docker compose run --rm --entrypoint sh pepsiwatch -c "git clone -q --depth 1 https://github.com/SighMonIs/PrintDesk.git r && cd r/pepsiwatch && python3 fetch.py --test"
  ```
