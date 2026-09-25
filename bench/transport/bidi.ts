// Minimal WebDriver BiDi client, just enough to install an unpacked
// extension into a throwaway Firefox profile without a human click.
// Firefox's Remote Agent (`--remote-debugging-port`) speaks BiDi directly
// on the port's root WebSocket — no HTTP /json/list discovery needed,
// unlike Chromium's CDP.

export async function biDiConnect(port: number): Promise<{
  send: (method: string, params: unknown) => Promise<any>;
  close: () => void;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
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

  return { send, close: () => ws.close() };
}

export async function biDiInstallExtension(port: number, extensionPath: string): Promise<string> {
  const { send, close } = await biDiConnect(port);
  try {
    await send("session.new", { capabilities: { alwaysMatch: {} } });
    const result = await send("webExtension.install", {
      extensionData: { type: "path", path: extensionPath },
    });
    return result.extension as string;
  } finally {
    close();
  }
}
