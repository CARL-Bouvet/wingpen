# Running the Chromium/Brave PoC (admin only)

This sandbox has no AF_UNIX, so Brave cannot start here — run this yourself.
Never touches the real broker (127.0.0.1:8787); the PoC server below owns
127.0.0.1:18801 only.

```sh
cd /home/romain/projets/wingpen

# 1. Start the PoC server (logs to bench/poc-origin/results/observations.ndjson)
bun bench/poc-origin/server.ts &

# 2. Launch Brave with a throwaway profile under .tmp/, loading only this extension
mkdir -p .tmp/brave-poc-origin
/usr/bin/brave \
  --user-data-dir=/home/romain/projets/wingpen/.tmp/brave-poc-origin \
  --disable-extensions-except=/home/romain/projets/wingpen/bench/poc-origin/ext-chromium \
  --load-extension=/home/romain/projets/wingpen/bench/poc-origin/ext-chromium \
  about:blank

# 3. After a few seconds, inspect the results:
cat bench/poc-origin/results/observations.ndjson | tail -5

# 4. Cleanup
kill %1   # the PoC server
rm -rf .tmp/brave-poc-origin
```

Look for three connections, labelled `chromium-serviceworker-control`,
`chromium-page-forged`, `chromium-offscreen-forged`. For each, check the
`origin` field: `chrome-extension://hehlgipomfminodhahcjbencblepjhah` means
the DNR rule (rules.json) forged it successfully; the extension's own
`chrome-extension://<random-id>` means it didn't (expected for the
service-worker control, per C2).
