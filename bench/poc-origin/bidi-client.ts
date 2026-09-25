// Minimal WebDriver BiDi client for lot L5 (goal-6t00P5LW), adapted from the
// pattern proven in bench/transport/bidi.ts (not imported/modified — that
// file is out of scope for this lot; this is a local, extended copy that
// additionally exposes BiDi *events* (log.entryAdded, etc.), which the
// transport bench's client does not need).
//
// Used only against Firefox's Remote Agent (--remote-debugging-port), never
// against the real broker (127.0.0.1:8787).

export type BiDiEvent = { method: string; params: any };

export async function connectBiDi(port: number): Promise<{
  send: (method: string, params: unknown) => Promise<any>;
  onEvent: (method: string, cb: (params: any) => void) => void;
  close: () => void;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  const eventHandlers = new Map<string, Array<(params: any) => void>>();

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === "event" && typeof msg.method === "string") {
      const handlers = eventHandlers.get(msg.method);
      if (handlers) for (const h of handlers) h(msg.params);
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id)!;
    pending.delete(msg.id);
    if (msg.type === "error") reject(new Error(`${msg.error}: ${msg.message}`));
    else resolve(msg.result);
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("BiDi ws open timeout")), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("BiDi ws error"));
    };
  });

  function send(method: string, params: unknown): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`BiDi ${method} timeout`));
        }
      }, 15000);
    });
  }

  function onEvent(method: string, cb: (params: any) => void) {
    if (!eventHandlers.has(method)) eventHandlers.set(method, []);
    eventHandlers.get(method)!.push(cb);
  }

  return { send, onEvent, close: () => ws.close() };
}
