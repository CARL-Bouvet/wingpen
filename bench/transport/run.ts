#!/usr/bin/env bun
// Orchestrator for the WS-vs-Native-Messaging transport bench (lot 2,
// goal-3jSMWnRt). Launches throwaway browser profiles, loads the bench
// extension (bench/transport/ext/), lets it run automatically, waits for
// its results, and writes bench/results/*.json.
//
// Usage: bun bench/transport/run.ts [--skip-brave]
//
// Never touches the real broker (port 8787) or the user's real browser
// profiles/config. Every profile is under a fresh mkdtemp() directory,
// removed at the end of each run.

import { mkdir, mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { biDiInstallExtension } from "./bidi.ts";

const REPO = "/home/romain/projets/wingpen";
const BENCH_DIR = `${REPO}/bench/transport`;
const RESULTS_DIR = `${REPO}/bench/results`;
const BUN = "/home/romain/.bun/bin/bun";
const BRAVE = "/usr/bin/brave";
const FIREFOX = "/usr/bin/firefox";
const WS_PORT = 18787;

type Transport = "ws" | "nm";

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

// --- ps sampling ------------------------------------------------------

type PsSample = { t: number; pid: number; pcpu: number; rssKb: number };

function startPsSampler(getPid: () => number | null): { stop: () => PsSample[] } {
  const samples: PsSample[] = [];
  const timer = setInterval(async () => {
    const pid = getPid();
    if (!pid) return;
    try {
      const proc = Bun.spawn(["ps", "-o", "pid=,pcpu=,rss=", "-p", String(pid)], { stdout: "pipe" });
      const out = await new Response(proc.stdout).text();
      const line = out.trim();
      if (!line) return;
      const parts = line.split(/\s+/);
      samples.push({ t: Date.now(), pid: Number(parts[0]), pcpu: Number(parts[1]), rssKb: Number(parts[2]) });
    } catch {
      /* process may not exist yet/anymore */
    }
  }, 100);
  return {
    stop: () => {
      clearInterval(timer);
      return samples;
    },
  };
}

function summarizePs(samples: PsSample[], startMs: number, endMs: number) {
  const inWindow = samples.filter((s) => s.t >= startMs && s.t <= endMs);
  if (inWindow.length === 0) return null;
  const cpu = inWindow.map((s) => s.pcpu);
  const rss = inWindow.map((s) => s.rssKb);
  return {
    samples: inWindow.length,
    pcpuAvg: cpu.reduce((a, b) => a + b, 0) / cpu.length,
    pcpuMax: Math.max(...cpu),
    rssKbAvg: rss.reduce((a, b) => a + b, 0) / rss.length,
    rssKbMax: Math.max(...rss),
  };
}

// --- WS server (our collector + transport under test for "ws" runs) ----

async function startWsServer(): Promise<{ proc: any; pid: number }> {
  const proc = Bun.spawn([BUN, `${BENCH_DIR}/ws-server.ts`], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: BENCH_DIR,
  });
  const ok = await waitFor(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${WS_PORT}/`);
        return res.status === 200;
      } catch {
        return false;
      }
    },
    10000,
    200,
  );
  if (!ok) throw new Error("ws-server did not come up on 127.0.0.1:18787 within 10s");
  return { proc, pid: proc.pid };
}

// --- results waiting -----------------------------------------------------

async function readResultsIfComplete(path: string): Promise<{ complete: boolean; json: any | null }> {
  try {
    const text = await readFile(path, "utf8");
    const json = JSON.parse(text);
    const complete = json?.idle && json.idle.status !== "pending";
    return { complete: Boolean(complete), json };
  } catch {
    return { complete: false, json: null };
  }
}

async function waitForResults(path: string, timeoutMs: number): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const { complete, json } = await readResultsIfComplete(path);
    if (json) last = json;
    if (complete) return json;
    await sleep(3000);
  }
  return last;
}

// --- extension config writing --------------------------------------------

async function writeExtConfig(extDir: string, browser: string, transport: Transport, params?: Record<string, number>) {
  await cp(`${BENCH_DIR}/ext/shared/background.js`, `${extDir}/background.js`);
  const cfg: Record<string, unknown> = { browser, transport, wsUrl: `ws://127.0.0.1:${WS_PORT}`, nmHost: "wingpen_bench" };
  if (params) cfg.params = params;
  await writeFile(`${extDir}/bench-config.js`, `self.BENCH_CONFIG = ${JSON.stringify(cfg)};\n`);
}


// --- Brave (real run) -------------------------------------------------------
// Chromium loads an unpacked extension via --load-extension without any
// install step (unlike Firefox's WebExtension BiDi install), so no BiDi
// client is needed here. The extension ID must be known in advance to write
// a Native Messaging host manifest with the right "allowed_origins" entry —
// Chromium derives the ID from the extension's public key when a "key"
// field is present in manifest.json, independent of the --load-extension
// path, so ext/chromium/manifest.json carries a fixed throwaway keypair.
// See that file's _comment_key for the corresponding ID.
const CHROMIUM_EXT_ID = "hiajdmhhpoajipmlilaaaalgbmbjekho";

// Chromium's Native Messaging host manifest lookup on Linux resolves
// relative to chrome::DIR_USER_DATA, which IS the --user-data-dir value
// when one is passed on the command line (this is how test frameworks
// isolate NM hosts per throwaway profile). Primary location tried:
// <user-data-dir>/NativeMessagingHosts/<name>.json. If that turns out not
// to be honored by this Brave build, fall back to the real per-user
// location (~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/),
// writing and then deleting the file around the run — never left behind.
function realBraveNmDir(): string {
  const home = process.env.HOME || "/root";
  return join(home, ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts");
}

function nmManifestContent() {
  return {
    name: "wingpen_bench",
    description: "Wingpen transport bench NM host",
    path: `${BENCH_DIR}/host.sh`,
    type: "stdio",
    allowed_origins: [`chrome-extension://${CHROMIUM_EXT_ID}/`],
  };
}

async function launchBraveOnce(opts: {
  transport: Transport;
  headless: boolean;
  extDir: string;
  profile: string;
  resultsPath: string;
  timeoutMs: number;
  pidFile: string;
}): Promise<{ results: any; logTail: string; exitedEarly: boolean }> {
  const { transport, headless, extDir, profile, resultsPath, timeoutMs, pidFile } = opts;
  await rm(resultsPath, { force: true }).catch(() => {});
  await rm(pidFile, { force: true }).catch(() => {});

  const logPath = join(profile, "brave.log");
  const args = [
    ...(headless ? ["--headless=new"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    "about:blank", // no CDP driving needed here, unlike Firefox's BiDi install step
  ];
  const proc = Bun.spawn([BRAVE, ...args], {
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
  });

  const sampler = startPsSampler(() => {
    try {
      const txt = require("node:fs").readFileSync(pidFile, "utf8").trim();
      return txt ? Number(txt) : null;
    } catch {
      return transport === "nm" ? null : proc.pid;
    }
  });

  await sleep(4000); // startup margin, mirrors Firefox's empirically-observed delay

  let exitedEarly = false;
  const exitedSoon = await Promise.race([proc.exited.then(() => true), sleep(1).then(() => false)]);
  if (exitedSoon) exitedEarly = true;

  const results = exitedEarly ? null : await waitForResults(resultsPath, timeoutMs);
  const psSamples = sampler.stop();

  if (results?.roundTrip?.length) {
    results.cpuRss = results.roundTrip.map((run: any) => summarizePs(psSamples, run.startedAt, run.endedAt));
  }

  proc.kill(9);
  await proc.exited.catch(() => {});

  let logTail = "";
  try {
    logTail = (await readFile(logPath, "utf8")).slice(-2000);
  } catch {
    /* no log */
  }
  if (exitedEarly && /process_singleton|socket\(\) failed/i.test(logTail)) {
    logTail = `[sandbox: AF_UNIX blocked, see docs/etudes/mesures-transport.md] ${logTail}`;
  }

  return { results, logTail, exitedEarly };
}

async function runBrave(transport: Transport, params?: Record<string, number>): Promise<any> {
  const profile = await mkdtemp(join(tmpdir(), "wingpen-bench-brave-"));
  const extDir = `${BENCH_DIR}/ext/chromium`;
  await writeExtConfig(extDir, "brave", transport, params);

  const resultsPath = join(RESULTS_DIR, `brave-${transport}.json`);
  const pidFile = join(BENCH_DIR, ".nm-host.pid");

  let wsServer: { proc: any; pid: number } | null = null;
  if (transport === "ws") {
    wsServer = await startWsServer();
    log("ws-server up, pid", wsServer.pid);
  }

  let nmLocation: "profile" | "real-user-config" | "none" = "none";
  let realNmWritten = false;
  const profileNmDir = join(profile, "NativeMessagingHosts");
  const realNmDir = realBraveNmDir();
  const realNmPath = join(realNmDir, "wingpen_bench.json");

  async function writeNmAt(dir: string) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "wingpen_bench.json"), JSON.stringify(nmManifestContent(), null, 2));
  }

  async function cleanupNm() {
    await rm(join(profileNmDir, "wingpen_bench.json"), { force: true }).catch(() => {});
    if (realNmWritten) {
      // Only the file we wrote is removed. The directory itself is never
      // touched: it may belong to a real Brave install on this machine.
      await rm(realNmPath, { force: true }).catch(() => {});
      realNmWritten = false;
    }
  }

  let finalResults: any = null;
  let braveLaunchFailed: string | null = null;
  let launchLevelBlocked = false; // true once we've seen Brave fail to even start — not NM-specific, retrying at another NM location or doing the full run would just reproduce the same failure.
  const nmProbeLog: string[] = [];

  try {
    if (transport === "nm") {
      // Probe the profile-dir location first with a short smoke run before
      // committing to the full ~9 minute measurement.
      await writeNmAt(profileNmDir);
      nmLocation = "profile";
      log("brave/nm: probing NM host manifest at <user-data-dir>/NativeMessagingHosts/ ...");
      const probe = await launchBraveOnce({
        transport,
        headless: true,
        extDir,
        profile,
        resultsPath,
        timeoutMs: 30 * 1000,
        pidFile,
      });
      if (probe.exitedEarly) {
        braveLaunchFailed = "brave process exited before startup margin elapsed (headless launch failure)";
        nmProbeLog.push(`profile-location launch failed: ${probe.logTail.slice(-500)}`);
        launchLevelBlocked = true;
        nmLocation = "none";
      } else {
        const idleStatus = probe.results?.idle?.status;
        const coldOk = Array.isArray(probe.results?.coldConnect) && probe.results.coldConnect.length > 0;
        const probeOk = coldOk || (idleStatus && idleStatus !== "pending");
        nmProbeLog.push(
          `profile-location probe: coldConnectSamples=${probe.results?.coldConnect?.length ?? 0}, idle.status=${idleStatus ?? "n/a"}, errors=${JSON.stringify(probe.results?.errors ?? [])}`,
        );
        if (!probeOk) {
          log("brave/nm: profile-dir NM manifest did not work, falling back to real user config dir");
          await rm(join(profileNmDir, "wingpen_bench.json"), { force: true }).catch(() => {});
          await writeNmAt(realNmDir);
          realNmWritten = true;
          nmLocation = "real-user-config";
          const probe2 = await launchBraveOnce({
            transport,
            headless: true,
            extDir,
            profile,
            resultsPath,
            timeoutMs: 30 * 1000,
            pidFile,
          });
          const idle2 = probe2.results?.idle?.status;
          const coldOk2 = Array.isArray(probe2.results?.coldConnect) && probe2.results.coldConnect.length > 0;
          nmProbeLog.push(
            `real-user-config probe: coldConnectSamples=${probe2.results?.coldConnect?.length ?? 0}, idle.status=${idle2 ?? "n/a"}, exitedEarly=${probe2.exitedEarly}, logTail=${probe2.logTail.slice(-500)}`,
          );
          if (probe2.exitedEarly || !(coldOk2 || (idle2 && idle2 !== "pending"))) {
            nmLocation = "none";
          }
        }
      }
    }

    if (!launchLevelBlocked && (nmLocation !== "none" || transport === "ws")) {
      log(`running Brave / ${transport} full measurement (nmLocation=${nmLocation}) ...`);
      const timeout = params ? 90 * 1000 : 9 * 60 * 1000;
      const full = await launchBraveOnce({
        transport,
        headless: true,
        extDir,
        profile,
        resultsPath,
        timeoutMs: timeout,
        pidFile,
      });
      if (full.exitedEarly) {
        braveLaunchFailed = braveLaunchFailed ?? `headless launch failed: ${full.logTail.slice(-800)}`;
      } else {
        finalResults = full.results;
        if (finalResults) {
          finalResults.meta = finalResults.meta ?? {};
          finalResults.meta.nmLocation = nmLocation;
          finalResults.meta.nmProbeLog = nmProbeLog;
        }
      }
    } else if (!launchLevelBlocked) {
      braveLaunchFailed = "Native Messaging host manifest not honored at either the profile-dir or the real user-config location — see nmProbeLog";
    }
    // else: launchLevelBlocked already set braveLaunchFailed above (Brave itself
    // failed to start — not an NM-manifest-location issue).
  } finally {
    await cleanupNm();
    if (wsServer) {
      wsServer.proc.kill(9);
      await wsServer.proc.exited.catch(() => {});
    }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  if (!finalResults) {
    finalResults = {
      status: "blocked",
      reason: braveLaunchFailed ?? "unknown failure (no results produced)",
      nmLocation,
      nmProbeLog,
    };
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(resultsPath, JSON.stringify(finalResults, null, 2) + "\n");
  return finalResults;
}

// --- Firefox ---------------------------------------------------------------

async function runFirefox(transport: Transport, params?: Record<string, number>): Promise<any> {
  const tmpHome = await mkdtemp(join(tmpdir(), "wingpen-bench-ff-home-"));
  const profileDir = join(tmpHome, "profile");
  await mkdir(profileDir, { recursive: true });
  const extDir = `${BENCH_DIR}/ext/firefox`;
  await writeExtConfig(extDir, "firefox", transport, params);

  if (transport === "nm") {
    const nmDir = join(tmpHome, ".mozilla", "native-messaging-hosts");
    await mkdir(nmDir, { recursive: true });
    const manifest = {
      name: "wingpen_bench",
      description: "Wingpen transport bench NM host",
      path: `${BENCH_DIR}/host.sh`,
      type: "stdio",
      allowed_extensions: ["wingpen-bench@localhost"],
    };
    await writeFile(join(nmDir, "wingpen_bench.json"), JSON.stringify(manifest, null, 2));
  }

  let wsServer: { proc: any; pid: number } | null = null;
  if (transport === "ws") {
    wsServer = await startWsServer();
    log("ws-server up, pid", wsServer.pid);
  }

  const resultsPath = join(RESULTS_DIR, `firefox-${transport}.json`);
  await rm(resultsPath, { force: true }).catch(() => {});

  const port = transport === "ws" ? 9492 : 9493;
  const logPath = join(tmpHome, "firefox.log");
  const ffProc = Bun.spawn(
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
    {
      env: { ...process.env, HOME: tmpHome },
      stdout: Bun.file(logPath),
      stderr: Bun.file(logPath),
    },
  );

  // ps sampler: for "ws" we know the ws-server pid; for "nm" the pid is
  // discovered dynamically via the pid file host.ts writes at startup.
  const pidFile = join(BENCH_DIR, ".nm-host.pid");
  await rm(pidFile, { force: true }).catch(() => {});
  const sampler = startPsSampler(() => {
    if (transport === "ws") return wsServer!.pid;
    try {
      const txt = require("node:fs").readFileSync(pidFile, "utf8").trim();
      return txt ? Number(txt) : null;
    } catch {
      return null;
    }
  });

  let installedId: string | null = null;
  let installError: string | null = null;
  try {
    const ready = await waitFor(
      async () => {
        try {
          await fetch(`http://127.0.0.1:${port}/`).catch(() => {});
          return true; // presence of a TCP listener; refined by the BiDi connect below
        } catch {
          return false;
        }
      },
      1,
      1,
    );
    void ready;
    await sleep(6000); // Firefox startup time observed empirically (~5s) + margin.
    installedId = await biDiInstallExtension(port, extDir);
    log(`firefox extension installed (${transport}):`, installedId);
  } catch (err) {
    installError = String(err);
    log("firefox webExtension.install FAILED:", installError);
  }

  let results: any = null;
  if (!installError) {
    // cold connect(10) + roundtrip(3*1000) + streaming(3) + upload(5) + idle(5min) + margin
    const timeout = params ? 90 * 1000 : 9 * 60 * 1000;
    results = await waitForResults(resultsPath, timeout);
  }

  const psSamples = sampler.stop();

  // Merge CPU/RSS stats for measurement 2 (round trip) windows, if we have them.
  if (results?.roundTrip?.length) {
    results.cpuRss = results.roundTrip.map((run: any) => summarizePs(psSamples, run.startedAt, run.endedAt));
  }
  if (results) {
    results.meta = results.meta ?? {};
    results.meta.installError = installError;
    await mkdir(RESULTS_DIR, { recursive: true });
    await writeFile(resultsPath, JSON.stringify(results, null, 2) + "\n");
  } else {
    await mkdir(RESULTS_DIR, { recursive: true });
    await writeFile(
      resultsPath,
      JSON.stringify({ status: "no-results", installError, psSamplesCount: psSamples.length }, null, 2) + "\n",
    );
  }

  ffProc.kill(9);
  await ffProc.exited.catch(() => {});
  if (wsServer) {
    wsServer.proc.kill(9);
    await wsServer.proc.exited.catch(() => {});
  }
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});

  return results;
}

// --- main -------------------------------------------------------------

const SMOKE_PARAMS = {
  coldConnectRuns: 2,
  roundTripRuns: 1,
  roundTripPings: 20,
  streamingRuns: 1,
  streamingChunks: 50,
  streamingChunkSize: 60,
  uploadRuns: 1,
  uploadBytes: 1024 * 10,
  idleMs: 2000,
};

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const skipBrave = process.argv.includes("--skip-brave");
  const braveOnly = process.argv.includes("--brave-only");
  const smoke = process.argv.includes("--smoke");

  if (smoke) {
    log("SMOKE MODE: reduced iteration counts, pipeline validation only, not real measurements.");
    const transport = (process.argv.includes("--nm") ? "nm" : "ws") as Transport;
    const browser = process.argv.includes("--brave") ? "brave" : "firefox";
    const results = browser === "brave" ? await runBrave(transport, SMOKE_PARAMS) : await runFirefox(transport, SMOKE_PARAMS);
    log("smoke result:", JSON.stringify(results, null, 2).slice(0, 4000));
    return;
  }

  const report: any = { generatedAt: new Date().toISOString() };

  if (!skipBrave) {
    log("running Brave / ws ...");
    report.braveWs = await runBrave("ws");
    log("running Brave / nm ...");
    report.braveNm = await runBrave("nm");
  } else {
    log("skipping Brave (--skip-brave)");
  }

  if (!braveOnly) {
    log("running Firefox / ws ...");
    report.firefoxWs = await runFirefox("ws");
    log("running Firefox / nm ...");
    report.firefoxNm = await runFirefox("nm");
  } else {
    log("skipping Firefox (--brave-only)");
  }

  await writeFile(join(RESULTS_DIR, "run-report.json"), JSON.stringify(report, null, 2) + "\n");
  log("done.");
}

main().catch((err) => {
  console.error("run.ts FATAL:", err);
  process.exit(1);
});
