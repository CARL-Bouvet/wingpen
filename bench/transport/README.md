# Transport bench (WS vs Native Messaging)

Isolated prototype for lot 2 of goal-3jSMWnRt. Never wired into the real
extension or broker. Compares WebSocket (`ws-server.ts`, `127.0.0.1:18787` —
never 8787, that's the real broker) against Native Messaging (`host.ts`,
standard 4-byte-length-prefixed JSON framing) on an identical set of
commands, using a minimal MV3 bench extension (`ext/`) that runs the whole
bench automatically on install and reports results back over the transport
under test.

## Layout

- `protocol.ts`, `handler.ts` — shared command set/behaviour for both transports.
- `host.ts`, `host.sh` — Native Messaging host (spawned by the browser; `host.sh` uses an absolute bun path since NM hosts get a minimal env).
- `ws-server.ts` — WebSocket collector/transport.
- `bidi.ts` — minimal WebDriver BiDi client (Firefox extension install, no human click).
- `ext/shared/background.js` — bench logic, copied into `ext/chromium/` and `ext/firefox/` by `run.ts` before each launch, alongside a generated `bench-config.js`.
- `run.ts` — orchestrator: throwaway profiles, launches, waits for results, `ps` sampling.
- `summarize.ts` — aggregates `bench/results/*.json` into `bench/results/summary.json`.

## Running it

```sh
bun bench/transport/run.ts              # full run: Brave attempt + Firefox (WS, NM)
bun bench/transport/run.ts --skip-brave # Firefox only
bun bench/transport/summarize.ts        # rebuild summary.json from existing result files
```

Takes ~15-20 minutes for a full run (two 5-minute idle-survival waits).
Quick pipeline check before a full run:

```sh
bun bench/transport/run.ts --smoke --ws   # or --nm; reduced counts, ~10s
```

## Known environment blocker

Chromium-based browsers (Brave) cannot launch in a sandbox that disallows
`AF_UNIX` sockets — Chrome's process-singleton check needs one unconditionally
on Linux, no CLI flag to skip it. `run.ts` still attempts it and writes the
exact crash into `bench/results/brave-*.json` with `status: "blocked"`. Works
fine in a normal terminal with AF_UNIX available — same command as above.

## Safety

Every browser profile is a fresh `mktemp` directory, removed at the end of
each run. Native Messaging host manifests are written under a throwaway
`$HOME` (Firefox) — never `~/.mozilla` or the real Brave config dir. Never
binds port 8787, never touches `~/.config/wingpen` or `~/.local/share/wingpen`.
