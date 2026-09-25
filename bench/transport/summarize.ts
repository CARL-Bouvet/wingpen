#!/usr/bin/env bun
// Builds bench/results/summary.json from the raw per-(browser,transport)
// result files. Read-only aggregation, no measurement here.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RESULTS_DIR = "/home/romain/projets/wingpen/bench/results";

async function loadJson(name: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(join(RESULTS_DIR, name), "utf8"));
  } catch {
    return null;
  }
}

function roundTripSummary(j: any) {
  if (!j?.roundTrip?.length) return null;
  const all = j.roundTrip;
  return {
    runs: all.length,
    p50PerRunMs: all.map((r: any) => r.p50),
    p95PerRunMs: all.map((r: any) => r.p95),
    p99PerRunMs: all.map((r: any) => r.p99),
  };
}

async function main() {
  const files = {
    "brave-ws": await loadJson("brave-ws.json"),
    "brave-nm": await loadJson("brave-nm.json"),
    "firefox-ws": await loadJson("firefox-ws.json"),
    "firefox-nm": await loadJson("firefox-nm.json"),
  };

  const summary: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  for (const [key, j] of Object.entries(files)) {
    if (!j) {
      summary[key] = { status: "missing" };
      continue;
    }
    if (j.status === "blocked") {
      summary[key] = { status: "blocked", reason: j.reason };
      continue;
    }
    summary[key] = {
      status: "ok",
      coldConnectMs: j.coldConnect ? { p50: j.coldConnect.p50, p95: j.coldConnect.p95, min: j.coldConnect.min, max: j.coldConnect.max } : null,
      roundTrip: roundTripSummary(j),
      streaming: j.streaming
        ? j.streaming.map((s: any) => ({ elapsedMs: s.elapsed, throughputBytesPerSec: s.throughputBytesPerSec }))
        : null,
      uploadMs: j.upload ? j.upload.map((u: any) => u.elapsed) : null,
      uploadErrors: j.upload ? j.upload.filter((u: any) => u.error).map((u: any) => u.error) : null,
      idle: j.idle,
      cpuRssDuringRoundTrip: j.cpuRss,
      errors: j.errors,
    };
  }

  await writeFile(join(RESULTS_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.error("wrote", join(RESULTS_DIR, "summary.json"));
}

main();
