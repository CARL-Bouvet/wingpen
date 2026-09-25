// Shared bench protocol used by both transports (WebSocket and Native
// Messaging) so the extension side and the results shape are identical
// regardless of which transport moved the bytes. Not part of the Wingpen
// product — isolated prototype for lot 2 of goal-3jSMWnRt (transport study).

export type BenchCommand =
  | { cmd: "hello" }
  | { cmd: "ping"; seq: number; t0: number }
  | { cmd: "stream-start"; count: number; size: number }
  | { cmd: "upload"; seq: number; data: string }
  | { cmd: "results"; browser: string; transport: string; measurements: unknown };

export type BenchReply =
  | { cmd: "hello-ok" }
  | { cmd: "pong"; seq: number; t0: number }
  | { cmd: "chunk"; seq: number; data: string }
  | { cmd: "stream-end"; count: number }
  | { cmd: "upload-ack"; seq: number; bytes: number }
  | { cmd: "results-ack" }
  | { cmd: "error"; message: string };

export const RESULTS_DIR = "/home/romain/projets/wingpen/bench/results";
