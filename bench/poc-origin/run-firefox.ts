#!/usr/bin/env bun
// Orchestrator for the three Firefox experiments of lot L5 (goal-6t00P5LW):
//   1. Origin-header forgery via webRequest blocking (C2/C3).
//   2. Temporary add-on moz-extension UUID stability (C5).
//   3. Loading the real Wingpen Firefox build, capturing uncaught exceptions.
//
// Everything lives under REPO/.tmp/ (throwaway HOME + profile dirs) or
// REPO/bench/poc-origin/ (extension sources, results). Nothing is written
// outside the repo. Never touches the real broker (127.0.0.1:8787) — our own
// PoC server listens on 127.0.0.1:18801, and experiment 3 even patches a
// *copy* of the real extension so its single WebSocket target points at our
// PoC server instead of the real broker.
//
// Usage: bun bench/poc-origin/run-firefox.ts [--exp=1|2|3]  (default: all)

import { mkdir, mkdtemp, rm, writeFile, cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { connectBiDi } from "./bidi-client.ts";

const REPO = "/home/romain/projets/wingpen";
const POC_DIR = `${REPO}/bench/poc-origin`;
const TMP_DIR = `${REPO}/.tmp`;
const RESULTS_DIR = `${POC_DIR}/results`;
const NDJSON_PATH = `${RESULTS_DIR}/observations.ndjson`;
const FIREFOX = "/usr/bin/firefox";
const BUN = "/home/romain/.bun/bin/bun";
const SERVER_PORT = 18801;
const WINGPEN_FIREFOX_GECKO_ID = "wingpen@localhost";

function log(...args: unknown[]) {
  console.error(new Date().toISOString(), ...args);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function homeEnv(homeDir: string) {
  await mkdir(join(homeDir, ".config"), { recursive: true });
  await mkdir(join(homeDir, ".cache"), { recursive: true });
  return {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_CACHE_HOME: join(homeDir, ".cache"),
  };
}

async function startServer(): Promise<{ proc: any }> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const proc = Bun.spawn([BUN, `${POC_DIR}/server.ts`], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: POC_DIR,
  });
  const ok = await waitFor(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/`);
        return res.status === 200;
      } catch {
        return false;
      }
    },
    10000,
    200,
  );
  if (!ok) throw new Error("poc-origin server did not come up on 127.0.0.1:18801 within 10s");
  return { proc };
}

async function stopServer(proc: any) {
  proc.kill(9);
  await proc.exited.catch(() => {});
}

async function readNdjson(): Promise<any[]> {
  try {
    const text = await readFile(NDJSON_PATH, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function lastByLabel(records: any[], label: string, sinceTs: number): any | null {
  const matches = records.filter((r) => r.label === label && Date.parse(r.t) >= sinceTs);
  return matches.length ? matches[matches.length - 1] : null;
}

async function writeFirefoxConfig(connections: Array<{ label: string; forge: boolean }>) {
  await writeFile(
    join(POC_DIR, "ext-firefox", "poc-config.js"),
    `self.POC_CONFIG = ${JSON.stringify({ connections })};\n`,
  );
}

function launchFirefox(opts: { homeEnv: NodeJS.ProcessEnv; profileDir: string; port: number; logPath: string }) {
  const { homeEnv: env, profileDir, port, logPath } = opts;
  return Bun.spawn(
    [
      FIREFOX,
      "--headless",
      "--new-instance",
      "--no-remote",
      "--profile",
      profileDir,
      "--remote-debugging-port",
      String(port),
      "about:blank",
    ],
    { env, stdout: Bun.file(logPath), stderr: Bun.file(logPath) },
  );
}

async function killFirefox(proc: any) {
  try {
    proc.kill(9);
  } catch {}
  await proc.exited.catch(() => {});
}

// --- Experiment 1: Origin forgery ------------------------------------------

async function runExperiment1() {
  log("=== Experiment 1: Origin header forgery (Firefox, webRequest blocking) ===");
  const sinceTs = Date.now();
  const home = join(TMP_DIR, "home-exp1");
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  const profileDir = join(home, "profile");
  await mkdir(profileDir, { recursive: true });

  await writeFirefoxConfig([
    { label: "firefox-real-origin", forge: false },
    { label: "firefox-forged-origin", forge: true },
  ]);

  const env = await homeEnv(home);
  const port = 9495;
  const logPath = join(home, "firefox.log");
  const proc = launchFirefox({ homeEnv: env, profileDir, port, logPath });

  let installedId: string | null = null;
  let installError: string | null = null;
  const consoleEntries: any[] = [];
  try {
    await sleep(6000);
    const { send, onEvent, close } = await connectBiDi(port);
    await send("session.new", { capabilities: { alwaysMatch: {} } });
    onEvent("log.entryAdded", (params) => consoleEntries.push(params));
    await send("session.subscribe", { events: ["log.entryAdded"] }).catch(() => {});
    const result = await send("webExtension.install", {
      extensionData: { type: "path", path: `${POC_DIR}/ext-firefox` },
    });
    installedId = result.extension;
    await sleep(5000); // both WS connections happen sequentially, ~1.5s apart
    close();
  } catch (err) {
    installError = String(err);
  }

  const records = await readNdjson();
  await killFirefox(proc);

  const real = lastByLabel(records, "firefox-real-origin", sinceTs);
  const forged = lastByLabel(records, "firefox-forged-origin", sinceTs);

  const result = {
    installedId,
    installError,
    realConnection: real,
    forgedConnection: forged,
    consoleEntries,
    verdict: {
      realOriginObserved: real?.origin ?? null,
      forgedOriginObserved: forged?.origin ?? null,
      forgerySucceeded: forged?.matchesWingpenChromeId === true,
    },
  };
  await writeFile(join(RESULTS_DIR, "exp1.json"), JSON.stringify(result, null, 2) + "\n");
  log("exp1 result:", JSON.stringify(result, null, 2));
  return result;
}

// --- Experiment 2: temporary add-on UUID stability --------------------------

async function runExperiment2() {
  log("=== Experiment 2: temporary add-on UUID stability, same profile ===");
  const home = join(TMP_DIR, "home-exp2");
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  const profileDir = join(home, "profile");
  await mkdir(profileDir, { recursive: true });

  const port = 9496;
  const result: any = { initial: null, reload: null, reloadError: null, restart: null };

  // --- initial install ---
  {
    const sinceTs = Date.now();
    await writeFirefoxConfig([{ label: "uuid-initial", forge: false }]);
    const env = await homeEnv(home);
    const logPath = join(home, "firefox-1.log");
    const proc = launchFirefox({ homeEnv: env, profileDir, port, logPath });
    await sleep(6000);
    const { send, close } = await connectBiDi(port);
    await send("session.new", { capabilities: { alwaysMatch: {} } });
    const installed = await send("webExtension.install", {
      extensionData: { type: "path", path: `${POC_DIR}/ext-firefox` },
    });
    await sleep(2500);
    let records = await readNdjson();
    let rec = lastByLabel(records, "uuid-initial", sinceTs);
    result.initial = { extensionHandle: installed.extension, origin: rec?.origin ?? null };

    // --- reload attempt, same running Firefox process ---
    const sinceReload = Date.now();
    try {
      await writeFirefoxConfig([{ label: "uuid-reload", forge: false }]);
      const reinstalled = await send("webExtension.install", {
        extensionData: { type: "path", path: `${POC_DIR}/ext-firefox` },
      });
      await sleep(2500);
      records = await readNdjson();
      rec = lastByLabel(records, "uuid-reload", sinceReload);
      result.reload = { extensionHandle: reinstalled.extension, origin: rec?.origin ?? null };
    } catch (err) {
      result.reloadError = String(err);
      // Fallback: explicit uninstall then reinstall.
      try {
        await send("webExtension.uninstall", { extension: installed.extension });
        await sleep(500);
        await writeFirefoxConfig([{ label: "uuid-reload", forge: false }]);
        const reinstalled2 = await send("webExtension.install", {
          extensionData: { type: "path", path: `${POC_DIR}/ext-firefox` },
        });
        await sleep(2500);
        records = await readNdjson();
        rec = lastByLabel(records, "uuid-reload", sinceReload);
        result.reload = { extensionHandle: reinstalled2.extension, origin: rec?.origin ?? null, viaUninstallFallback: true };
      } catch (err2) {
        result.reloadFallbackError = String(err2);
      }
    }

    close();
    await killFirefox(proc);
  }

  // --- restart Firefox on the SAME profile dir, reinstall ---
  {
    const sinceTs = Date.now();
    await writeFirefoxConfig([{ label: "uuid-restart", forge: false }]);
    const env = await homeEnv(home);
    const logPath = join(home, "firefox-2.log");
    const proc = launchFirefox({ homeEnv: env, profileDir, port, logPath });
    await sleep(6000);
    try {
      const { send, close } = await connectBiDi(port);
      await send("session.new", { capabilities: { alwaysMatch: {} } });
      const installed = await send("webExtension.install", {
        extensionData: { type: "path", path: `${POC_DIR}/ext-firefox` },
      });
      await sleep(2500);
      const records = await readNdjson();
      const rec = lastByLabel(records, "uuid-restart", sinceTs);
      result.restart = { extensionHandle: installed.extension, origin: rec?.origin ?? null };
      close();
    } catch (err) {
      result.restartError = String(err);
    }
    await killFirefox(proc);
  }

  result.verdict = {
    uuidInitial: result.initial?.origin ?? null,
    uuidAfterReload: result.reload?.origin ?? null,
    uuidAfterRestart: result.restart?.origin ?? null,
    sameAcrossReload: result.initial?.origin && result.reload?.origin ? result.initial.origin === result.reload.origin : null,
    sameAcrossRestart: result.initial?.origin && result.restart?.origin ? result.initial.origin === result.restart.origin : null,
  };

  await writeFile(join(RESULTS_DIR, "exp2.json"), JSON.stringify(result, null, 2) + "\n");
  log("exp2 result:", JSON.stringify(result, null, 2));
  return result;
}

// --- Experiment 3: real Wingpen Firefox build, uncaught exceptions ---------

async function patchRealBuildCopy(): Promise<string> {
  const src = `${REPO}/dist/stage/firefox`;
  const dst = join(TMP_DIR, "wingpen-real-copy");
  await rm(dst, { recursive: true, force: true });
  await cp(src, dst, { recursive: true });

  // Patch 1/2: redirect the single WebSocket target away from the real
  // broker (127.0.0.1:8787) to our own throwaway PoC server, so loading this
  // build never touches the real broker.
  const swPath = join(dst, "background", "service-worker.js");
  const originalSw = await readFile(swPath, "utf8");
  const patchedSw = originalSw.replace(
    "const BROKER_PORT = 8787;",
    `const BROKER_PORT = ${SERVER_PORT}; // PATCHED by bench/poc-origin/run-firefox.ts, see notes/poc-origin-resultats.md.`,
  );
  if (patchedSw === originalSw) {
    throw new Error(`patchRealBuildCopy: BROKER_PORT constant not found as expected in ${swPath} — refusing to load unpatched (would connect to the real broker).`);
  }
  await writeFile(swPath, patchedSw);

  // Patch 2/2: the manifest's CSP connect-src only allows ws://127.0.0.1:8787
  // by design (docs/PROTOCOL.md "Transport" — the port is deliberately
  // hardcoded in both places). Without this second patch, patch 1 alone
  // would make the WebSocket constructor throw a CSP violation instead of
  // connecting to our PoC server, which would corrupt the exception count
  // for experiment 3.
  const manifestPath = join(dst, "manifest.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const patchedManifest = originalManifest.replace(
    `ws://127.0.0.1:${8787}`,
    `ws://127.0.0.1:${SERVER_PORT}`,
  );
  if (patchedManifest === originalManifest) {
    throw new Error(`patchRealBuildCopy: CSP connect-src ws://127.0.0.1:8787 not found as expected in ${manifestPath}.`);
  }
  await writeFile(manifestPath, patchedManifest);

  return dst;
}

async function runExperiment3() {
  log("=== Experiment 3: real Wingpen Firefox build, uncaught exceptions at load ===");
  const extDir = await patchRealBuildCopy();
  const home = join(TMP_DIR, "home-exp3");
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });
  const profileDir = join(home, "profile");
  await mkdir(profileDir, { recursive: true });

  const sinceTs = Date.now();
  const env = await homeEnv(home);
  const port = 9497;
  const logPath = join(home, "firefox.log");
  const proc = launchFirefox({ homeEnv: env, profileDir, port, logPath });

  const logEntries: any[] = [];
  let installedId: string | null = null;
  let installError: string | null = null;
  let subscribeError: string | null = null;

  try {
    await sleep(6000);
    const { send, onEvent, close } = await connectBiDi(port);
    await send("session.new", { capabilities: { alwaysMatch: {} } });
    onEvent("log.entryAdded", (params) => logEntries.push({ t: new Date().toISOString(), ...params }));
    try {
      await send("session.subscribe", { events: ["log.entryAdded"] });
    } catch (err) {
      subscribeError = String(err);
    }
    const result = await send("webExtension.install", { extensionData: { type: "path", path: extDir } });
    installedId = result.extension;
    await sleep(5000); // let the background page init and connect

    // The background page itself is not a browsingContext BiDi exposes (see
    // notes/poc-origin-resultats.md) — but the sidebar panel is a real page,
    // so navigating a tab to it directly (bypassing the sidebar UI, which
    // BiDi/headless has no concept of) gives log.entryAdded a real chance to
    // capture whatever panel.js throws once we know the assigned UUID.
    const preNav = await readNdjson();
    const brokerHit = preNav.find((r) => Date.parse(r.t) >= sinceTs && r.kind === "moz-extension");
    if (brokerHit?.origin) {
      try {
        const tree = await send("browsingContext.getTree", {});
        const ctx = tree.contexts[0].context;
        await send("browsingContext.navigate", {
          context: ctx,
          url: `${brokerHit.origin}/panel/panel.html`,
          wait: "complete",
        });
        await sleep(3000);
      } catch (err) {
        log("exp3: panel navigation failed:", String(err));
      }
    } else {
      log("exp3: no moz-extension Origin observed yet, skipping panel navigation");
    }

    close();
  } catch (err) {
    installError = String(err);
  }

  const records = await readNdjson();
  await killFirefox(proc);

  const brokerConnectionAttempt = records.find((r) => Date.parse(r.t) >= sinceTs && r.kind === "moz-extension");

  const errorEntries = logEntries.filter((e) => e.level === "error" || /exception|error/i.test(String(e.text ?? "")));

  // BiDi's log.entryAdded does not cover WebExtension background contexts in
  // this Firefox build (confirmed separately: extension background pages
  // never appear in browsingContext.getTree either — see
  // notes/poc-origin-resultats.md). Uncaught exceptions/rejections in
  // privileged/background JS are instead dumped straight to stdout/stderr by
  // Firefox when run from a terminal, which launchFirefox() already
  // redirects to logPath — so that's the real source of truth here.
  const rawLog = await readFile(logPath, "utf8").catch(() => "");
  const stdoutExceptionLines = rawLog
    .split("\n")
    .filter((l) => /uncaught exception|JavaScript error/i.test(l));

  const result = {
    installedId,
    installError,
    subscribeError,
    brokerConnectionAttempt, // should show our PoC server (18801), never the real broker
    totalLogEntries: logEntries.length,
    errorEntries: errorEntries.slice(0, 5),
    stdoutExceptionLines: stdoutExceptionLines.slice(0, 5),
    allLogEntries: logEntries,
  };
  await writeFile(join(RESULTS_DIR, "exp3.json"), JSON.stringify(result, null, 2) + "\n");
  log("exp3 result:", JSON.stringify({ ...result, allLogEntries: `[${logEntries.length} entries, see exp3.json]` }, null, 2));
  return result;
}

// --- main -------------------------------------------------------------------

async function main() {
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(RESULTS_DIR, { recursive: true });
  const which = process.argv.find((a) => a.startsWith("--exp="))?.split("=")[1];

  const { proc: serverProc } = await startServer();
  log("poc-origin server up");

  try {
    if (!which || which === "1") await runExperiment1();
    if (!which || which === "2") await runExperiment2();
    if (!which || which === "3") await runExperiment3();
  } finally {
    await stopServer(serverProc);
  }
  log("done.");
}

main().catch((err) => {
  console.error("run-firefox.ts FATAL:", err);
  process.exit(1);
});
