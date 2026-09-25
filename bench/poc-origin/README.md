# poc-origin — Origin-forgery / Firefox UUID PoC (lot L5, goal-6t00P5LW)

Isolated prototype, never wired into Wingpen. Verifies C2/C5 from
notes/recherche_appairage_2026-09-25.md and notes/recherche_refutation.md.
Never touches the real broker (127.0.0.1:8787) — everything targets our own
`server.ts`, on 127.0.0.1:18801. Full write-up: notes/poc-origin-resultats.md.

## Firefox experiments (this worker ran these)

```sh
bun bench/poc-origin/run-firefox.ts           # all 3 experiments
bun bench/poc-origin/run-firefox.ts --exp=1   # Origin forgery only
bun bench/poc-origin/run-firefox.ts --exp=2   # UUID stability only
bun bench/poc-origin/run-firefox.ts --exp=3   # real build, uncaught exceptions
```

Writes `bench/poc-origin/results/exp{1,2,3}.json` and appends every
connection's headers to `bench/poc-origin/results/observations.ndjson`.
Throwaway `HOME`/profiles live under `../../.tmp/home-exp*` and are
recreated on each run.

## Chromium/Brave experiment (admin only — see `ext-chromium/README.md`)

This sandbox has no AF_UNIX; Brave cannot launch here.
