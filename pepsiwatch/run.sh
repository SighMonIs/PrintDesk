#!/bin/sh
# Clone the site repo, then loop: scrape prices, commit, push, sleep.
# fetch.py comes from the clone, so updating it in git needs no image rebuild.
set -e
: "${GITHUB_TOKEN:?set GITHUB_TOKEN (fine-grained PAT with Contents: read/write on the repo)}"
REPO=${REPO:-SighMonIs/PrintDesk}
INTERVAL=${INTERVAL:-6h}

[ -d repo ] || git clone -q --depth 1 "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" repo
cd repo
git config user.name pepsiwatch
git config user.email pepsiwatch@users.noreply.github.com

while true; do
  git pull -q --rebase || echo "pull failed, continuing with local copy"
  (cd pepsiwatch && python3 fetch.py) || echo "fetch failed"
  git add pepsiwatch/prices.json
  if ! git diff --cached --quiet; then
    git commit -q -m "pepsiwatch: update prices" && git push -q && echo "pushed $(date -u +%FT%TZ)"
  fi
  sleep "$INTERVAL"
done
