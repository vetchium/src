import {
  MessageChannel,
  type MessagePort,
  receiveMessageOnPort,
  Worker,
} from "node:worker_threads";

export interface PsqlTarget {
  container: string;
  user: string;
  password: string;
  database: string;
}

export interface PsqlRequest {
  target: PsqlTarget;
  sql: string;
}

export type PsqlReply =
  | { ok: true; stdout: string }
  | { ok: false; error: string };

export interface PsqlWorkerData {
  port: MessagePort;
  signal: Int32Array;
}

interface Bridge {
  worker: Worker;
  port: MessagePort;
  signal: Int32Array;
}

// Longer than the worker's own request timeout, so a reply normally arrives
// first; this only catches a worker that died.
const replyTimeoutMS = 90_000;

let bridge: Bridge | undefined;

function startBridge(): Bridge {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const workerData: PsqlWorkerData = { port: port2, signal };
  const worker = new Worker(
    new URL("./psql-sessions-worker.ts", import.meta.url),
    {
      workerData,
      transferList: [port2],
      execArgv: process.features.typescript
        ? []
        : ["--experimental-strip-types"],
    },
  );
  // The sessions end with this process: psql exits when its stdin closes.
  worker.unref();
  return { worker, port: port1, signal };
}

/**
 * Runs `sql` as `psql -Atqc` would, on a session this Playwright worker keeps
 * open, and returns its unaligned output. A multi-statement string is one
 * transaction. Throws with psql's error output when the SQL fails.
 *
 * Synchronous because every database helper is; it blocks the thread, as the
 * `execFileSync` it replaces did, while a worker thread runs the query.
 */
export function psqlSync(target: PsqlTarget, sql: string): string {
  bridge ??= startBridge();
  Atomics.store(bridge.signal, 0, 0);
  const request: PsqlRequest = { target, sql };
  bridge.worker.postMessage(request);
  if (Atomics.wait(bridge.signal, 0, 0, replyTimeoutMS) === "timed-out") {
    bridge.worker.terminate();
    bridge = undefined;
    throw new Error(`psql worker did not answer for ${target.container}`);
  }
  const reply = receiveMessageOnPort(bridge.port)?.message as
    | PsqlReply
    | undefined;
  if (reply === undefined) {
    throw new Error(`psql worker sent no reply for ${target.container}`);
  }
  if (!reply.ok) {
    throw new Error(`psql failed on ${target.container}: ${reply.error}`);
  }
  return reply.stdout;
}
