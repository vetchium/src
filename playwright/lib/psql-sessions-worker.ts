import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { type MessagePort, parentPort, workerData } from "node:worker_threads";
import type {
  PsqlReply,
  PsqlRequest,
  PsqlTarget,
  PsqlWorkerData,
} from "./psql-sessions.ts";

// Owns one long-lived psql per database for its Playwright worker and answers
// the blocking psqlSync calls of psql-sessions.ts.

const requestTimeoutMS = 60_000;
const { port, signal } = workerData as PsqlWorkerData;

interface Session {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  exited: boolean;
  /** Re-checks the pending request after new output or exit. */
  onChange: () => void;
}

const sessions = new Map<string, Session>();

function openSession(target: PsqlTarget): Session {
  const child = spawn("docker", [
    "exec",
    "-i",
    target.container,
    "env",
    `PGPASSWORD=${target.password}`,
    "psql",
    "-X",
    "-q",
    "-A",
    "-t",
    "-U",
    target.user,
    "-d",
    target.database,
  ]);
  const session: Session = {
    child,
    stdout: "",
    stderr: "",
    exited: false,
    onChange: () => {},
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    session.stdout += chunk;
    session.onChange();
  });
  child.stderr.on("data", (chunk: string) => {
    session.stderr += chunk;
    session.onChange();
  });
  // A failed docker exec reports through "error" and "exit"; both end the
  // session so the next request starts a fresh one. Writes to a dead psql
  // fail with EPIPE, which the exit already reports.
  const end = () => {
    session.exited = true;
    forget(target, session);
    session.onChange();
  };
  child.once("error", end);
  child.once("exit", end);
  child.stdin.on("error", () => {});
  return session;
}

function sessionKey(target: PsqlTarget): string {
  return `${target.container}/${target.database}/${target.user}`;
}

function forget(target: PsqlTarget, session: Session): void {
  const key = sessionKey(target);
  if (sessions.get(key) === session) sessions.delete(key);
}

/**
 * Resolves with each stream's text before `marker` and drops it, marker line
 * included, from the session buffers.
 */
function untilMarker(
  target: PsqlTarget,
  session: Session,
  marker: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      session.onChange = () => {};
      forget(target, session);
      session.child.kill();
      reject(new Error(`psql session timed out: ${session.stderr}`));
    }, requestTimeoutMS);
    session.onChange = () => {
      const out = session.stdout.indexOf(`${marker}\n`);
      const err = session.stderr.indexOf(`${marker}\n`);
      if (out >= 0 && err >= 0) {
        clearTimeout(timeout);
        session.onChange = () => {};
        const result = {
          stdout: session.stdout.slice(0, out),
          stderr: session.stderr.slice(0, err),
        };
        session.stdout = session.stdout.slice(out + marker.length + 1);
        session.stderr = session.stderr.slice(err + marker.length + 1);
        resolvePromise(result);
      } else if (session.exited) {
        clearTimeout(timeout);
        session.onChange = () => {};
        reject(new Error(`psql session exited: ${session.stderr}`));
      }
    };
    session.onChange();
  });
}

async function run({ target, sql }: PsqlRequest): Promise<PsqlReply> {
  const key = sessionKey(target);
  let session = sessions.get(key);
  if (session === undefined) {
    session = openSession(target);
    sessions.set(key, session);
  }
  const id = randomBytes(8).toString("hex");
  const tag = `$sql_${id}$`;
  const done = `psql_done_${id}`;
  const clean = `psql_clean_${id}`;
  // \gexec sends the whole string as one query, as `psql -c` does: one
  // implicit transaction whatever its statement count. Each stream then gets
  // a marker so this request's stderr is complete and separate. ROLLBACK and
  // DISCARD ALL leave the session as fresh as a new connection; their output,
  // such as the warning when no transaction is open, is discarded.
  session.child.stdin.write(
    `SELECT ${tag}${sql}${tag} \\gexec\n` +
      `\\warn ${done}\n` +
      `\\echo :ERROR\n` +
      `\\echo ${done}\n` +
      "ROLLBACK;\nDISCARD ALL;\n" +
      `\\warn ${clean}\n` +
      `\\echo ${clean}\n`,
  );
  const result = await untilMarker(target, session, done);
  await untilMarker(target, session, clean);
  const statusEnd = result.stdout.lastIndexOf("\n", result.stdout.length - 2);
  const status = result.stdout.slice(statusEnd + 1).trim();
  const stdout = result.stdout.slice(0, statusEnd + 1);
  if (status === "true") return { ok: false, error: result.stderr };
  if (status !== "false") {
    throw new Error(`psql reported no status: ${result.stdout}`);
  }
  return { ok: true, stdout };
}

(parentPort as MessagePort).on("message", (request: PsqlRequest) => {
  run(request)
    .catch((error: unknown): PsqlReply => {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    })
    .then((reply) => {
      port.postMessage(reply);
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    });
});
