import { execFile, execFileSync, spawn } from "node:child_process";
import {
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tenantID = "sgp";

function assertOwnedEmail(emailAddress: string): void {
  if (!/^e2e\+[a-z0-9-]+@example\.test$/.test(emailAddress)) {
    throw new Error(
      `refusing database operation for non-test email: ${emailAddress}`,
    );
  }
}

function assertOwnedDomain(domain: string): void {
  if (!/^e2e-[a-z0-9-]+\.example\.test$/.test(domain)) {
    throw new Error(
      `refusing database operation for non-test domain: ${domain}`,
    );
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type TestTenant = "deu" | "sgp";

function sqlScalarForTenant(tenant: TestTenant, sql: string): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      "exec",
      "-T",
      `db-${tenant}`,
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-U",
      "pguser",
      "-d",
      "tenant_db",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atqc",
      sql,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
}

function dockerCompose(args: string[]): string {
  return execFileSync(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      ...args,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
}

function dockerComposeAsync(args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "docker",
      [
        "compose",
        "-f",
        resolve(repositoryRoot, "docker-compose-ci.json"),
        ...args,
      ],
      { cwd: repositoryRoot, encoding: "utf8", timeout },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${error.message}: ${stderr}`));
          return;
        }
        resolvePromise(stdout.trim());
      },
    );
  });
}

function runMigration(databaseName: string): void {
  if (!/^e2e_migration_[a-f0-9]{32}$/.test(databaseName)) {
    throw new Error(
      `refusing to migrate unsafe test database: ${databaseName}`,
    );
  }
  dockerCompose([
    "run",
    "--rm",
    "--no-deps",
    "-e",
    `GOOSE_DBSTRING=postgres://pguser:pgpassword@db-sgp:5432/${databaseName}?sslmode=disable`,
    "migrate-sgp",
    "up",
  ]);
}

export async function credentialRefreshPruneRace(): Promise<{
  freshIdempotencyRows: number;
  freshPasswordResets: number;
  prunedIdempotencyRows: number;
  prunedPasswordResets: number;
}> {
  const databaseName = `e2e_migration_${randomBytes(16).toString("hex")}`;
  const marker = `refresh_ready_${randomBytes(8).toString("hex")}`;
  dockerCompose([
    "exec",
    "-T",
    "db-sgp",
    "env",
    "PGPASSWORD=pgpassword",
    "createdb",
    "-U",
    "pguser",
    databaseName,
  ]);
  let sessionExited = false;
  const session = spawn(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  session.stdout.setEncoding("utf8");
  session.stderr.setEncoding("utf8");
  session.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  session.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolvePromise, reject) => {
    session.once("error", reject);
    session.once("exit", (code) => {
      sessionExited = true;
      if (code === 0) resolvePromise();
      else reject(new Error(`refresh SQL session exited ${code}: ${stderr}`));
    });
  });
  try {
    runMigration(databaseName);
    const ready = new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `refresh SQL session did not become ready: ${stdout} ${stderr}`,
            ),
          ),
        10_000,
      );
      const onData = () => {
        if (stdout.includes(marker)) {
          clearTimeout(timeout);
          session.stdout.off("data", onData);
          resolvePromise();
        }
      };
      session.stdout.on("data", onData);
      session.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`refresh SQL session exited before ready: ${stderr}`));
      });
    });
    session.stdin.write(`
      INSERT INTO vetchium.admin_users (
        email_address, display_name, password_hash
      ) VALUES ('race@example.test', 'Race Admin', 'unused-test-hash');
      BEGIN;
      INSERT INTO vetchium.admin_password_reset_tokens (
        admin_user_id, token_hash, created_at, expires_at
      ) SELECT admin_user_id, decode(repeat('11', 32), 'hex'),
          now() - interval '2 hours', now() - interval '1 hour'
        FROM vetchium.admin_users WHERE email_address = 'race@example.test';
      INSERT INTO vetchium.idempotency_ledger (
        operation, binding_id, idempotency_key, request_digest,
        created_at, expires_at
      ) VALUES (
        'admin:race-probe', 'race-binding', 'e2e-race-probe-key-000001',
        decode(repeat('33', 32), 'hex'),
        now() - interval '2 hours', now() - interval '1 hour'
      );
      COMMIT;
      BEGIN;
      SELECT admin_password_reset_token_id
      FROM vetchium.admin_password_reset_tokens
      WHERE token_hash = decode(repeat('11', 32), 'hex')
      FOR UPDATE;
      SELECT operation
      FROM vetchium.idempotency_ledger
      WHERE operation = 'admin:race-probe'
      FOR UPDATE;
      UPDATE vetchium.admin_password_reset_tokens
      SET token_hash = decode(repeat('22', 32), 'hex'),
          created_at = now(), expires_at = now() + interval '30 minutes'
      WHERE token_hash = decode(repeat('11', 32), 'hex');
      DELETE FROM vetchium.idempotency_ledger
      WHERE operation = 'admin:race-probe';
      INSERT INTO vetchium.idempotency_ledger (
        operation, binding_id, idempotency_key, request_digest, expires_at
      ) VALUES (
        'admin:race-probe', 'race-binding', 'e2e-race-probe-key-000001',
        decode(repeat('44', 32), 'hex'), now() + interval '1 hour'
      );
      SELECT '${marker}';
    `);
    await ready;

    const pruneResult = await dockerComposeAsync([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atqc",
      `
        WITH reset_candidates AS MATERIALIZED (
          SELECT admin_password_reset_token_id
          FROM vetchium.admin_password_reset_tokens
          WHERE expires_at <= now() OR consumed_at IS NOT NULL
          ORDER BY COALESCE(consumed_at, expires_at)
          FOR UPDATE SKIP LOCKED
          LIMIT 1000
        ), reset_deleted AS (
          DELETE FROM vetchium.admin_password_reset_tokens AS reset
          USING reset_candidates AS candidate
          WHERE reset.admin_password_reset_token_id =
            candidate.admin_password_reset_token_id
          RETURNING 1
        ), idempotency_candidates AS MATERIALIZED (
          SELECT operation, binding_id, idempotency_key
          FROM vetchium.idempotency_ledger
          WHERE expires_at <= now()
          ORDER BY expires_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1000
        ), idempotency_deleted AS (
          DELETE FROM vetchium.idempotency_ledger AS ledger
          USING idempotency_candidates AS candidate
          WHERE ledger.operation = candidate.operation
            AND ledger.binding_id = candidate.binding_id
            AND ledger.idempotency_key = candidate.idempotency_key
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM reset_deleted)::text || '|' ||
          (SELECT count(*) FROM idempotency_deleted)::text;
      `,
    ]);
    session.stdin.write("COMMIT;\n\\q\n");
    await exited;

    const freshResult = dockerCompose([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-Atqc",
      `
        SELECT
          (SELECT count(*) FROM vetchium.admin_password_reset_tokens
            WHERE token_hash = decode(repeat('22', 32), 'hex')
              AND expires_at > now())::text || '|' ||
          (SELECT count(*) FROM vetchium.idempotency_ledger
            WHERE operation = 'admin:race-probe'
              AND request_digest = decode(repeat('44', 32), 'hex')
              AND expires_at > now())::text;
      `,
    ]);
    const [prunedPasswordResets, prunedIdempotencyRows] = pruneResult
      .split("|")
      .map(Number);
    const [freshPasswordResets, freshIdempotencyRows] = freshResult
      .split("|")
      .map(Number);
    if (
      prunedPasswordResets === undefined ||
      prunedIdempotencyRows === undefined ||
      freshPasswordResets === undefined ||
      freshIdempotencyRows === undefined
    ) {
      throw new Error(
        `invalid prune race results: ${pruneResult}; ${freshResult}`,
      );
    }
    return {
      freshIdempotencyRows,
      freshPasswordResets,
      prunedIdempotencyRows,
      prunedPasswordResets,
    };
  } finally {
    if (!sessionExited) {
      session.stdin.write("ROLLBACK;\n\\q\n");
      await exited.catch(() => {});
    }
    dockerCompose([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "dropdb",
      "-U",
      "pguser",
      "--force",
      databaseName,
    ]);
  }
}

async function waitForDatabaseLockWaiters(
  databaseName: string,
  applicationNames: string[],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const count = Number(
      dockerCompose([
        "exec",
        "-T",
        "db-sgp",
        "env",
        "PGPASSWORD=pgpassword",
        "psql",
        "-U",
        "pguser",
        "-d",
        "postgres",
        "-Atqc",
        `
          SELECT count(*)
          FROM pg_stat_activity
          WHERE datname = ${sqlLiteral(databaseName)}
            AND application_name IN (
              ${applicationNames.map(sqlLiteral).join(", ")}
            )
            AND wait_event_type = 'Lock';
        `,
      ]),
    );
    if (count === applicationNames.length) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(
    "login creation statements did not reach the credential locks",
  );
}

export async function stalePasswordLoginCreationRace(): Promise<{
  challengesCreated: number;
  sessionsCreated: number;
}> {
  const databaseName = `e2e_migration_${randomBytes(16).toString("hex")}`;
  const marker = `password_changed_${randomBytes(8).toString("hex")}`;
  const directApplication = `e2e_direct_${randomBytes(8).toString("hex")}`;
  const totpApplication = `e2e_totp_${randomBytes(8).toString("hex")}`;
  dockerCompose([
    "exec",
    "-T",
    "db-sgp",
    "env",
    "PGPASSWORD=pgpassword",
    "createdb",
    "-U",
    "pguser",
    databaseName,
  ]);
  runMigration(databaseName);

  let changeExited = false;
  const change = spawn(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  change.stdout.setEncoding("utf8");
  change.stderr.setEncoding("utf8");
  change.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  change.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolvePromise, reject) => {
    change.once("error", reject);
    change.once("exit", (code) => {
      changeExited = true;
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`password-change SQL session exited ${code}: ${stderr}`),
        );
    });
  });
  try {
    const changed = new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `password change did not become ready: ${stdout} ${stderr}`,
            ),
          ),
        10_000,
      );
      const onData = () => {
        if (stdout.includes(marker)) {
          clearTimeout(timeout);
          change.stdout.off("data", onData);
          resolvePromise();
        }
      };
      change.stdout.on("data", onData);
      change.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(`password change exited before ready: ${stderr}`));
      });
    });
    change.stdin.write(`
      INSERT INTO vetchium.admin_users (
        email_address, display_name, password_hash
      ) VALUES
        ('direct-race@example.test', 'Direct Race', 'verified-old-hash'),
        ('totp-race@example.test', 'TOTP Race', 'verified-old-hash');
      UPDATE vetchium.admin_users
      SET totp_secret_ciphertext = decode('01', 'hex'), totp_enabled = true
      WHERE email_address = 'totp-race@example.test';
      BEGIN;
      UPDATE vetchium.admin_users
      SET password_hash = 'replacement-hash', updated_at = now()
      WHERE email_address IN (
        'direct-race@example.test', 'totp-race@example.test'
      );
      SELECT '${marker}';
    `);
    await changed;

    const psqlPrefix = (applicationName: string) => [
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      `PGAPPNAME=${applicationName}`,
      "psql",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atqc",
    ];
    const directAttempt = dockerComposeAsync([
      ...psqlPrefix(directApplication),
      `
        WITH eligible AS (
          UPDATE vetchium.admin_users
          SET last_login_at = now(), updated_at = now()
          WHERE email_address = 'direct-race@example.test'
            AND admin_user_state = 'active'
            AND password_hash = 'verified-old-hash'
            AND NOT totp_enabled
          RETURNING admin_user_id
        ), inserted AS (
          INSERT INTO vetchium.admin_sessions (
            session_token_hash, admin_user_id, expires_at, authenticated_at
          ) SELECT decode(repeat('55', 32), 'hex'), admin_user_id,
              now() + interval '1 hour', now()
            FROM eligible
          RETURNING 1
        )
        SELECT count(*) FROM inserted;
      `,
    ]);
    const totpAttempt = dockerComposeAsync([
      ...psqlPrefix(totpApplication),
      `
        WITH eligible AS (
          SELECT admin_user_id
          FROM vetchium.admin_users
          WHERE email_address = 'totp-race@example.test'
            AND password_hash = 'verified-old-hash'
            AND admin_user_state = 'active'
            AND totp_enabled
          FOR UPDATE
        ), inserted AS (
          INSERT INTO vetchium.admin_login_challenges (
            admin_user_id, token_hash, expires_at
          ) SELECT admin_user_id, decode(repeat('66', 32), 'hex'),
              now() + interval '5 minutes'
            FROM eligible
          RETURNING 1
        )
        SELECT count(*) FROM inserted;
      `,
    ]);

    await waitForDatabaseLockWaiters(databaseName, [
      directApplication,
      totpApplication,
    ]);
    change.stdin.write("COMMIT;\n\\q\n");
    await exited;
    const [directResult, totpResult] = await Promise.all([
      directAttempt,
      totpAttempt,
    ]);
    return {
      sessionsCreated: Number(directResult),
      challengesCreated: Number(totpResult),
    };
  } finally {
    if (!changeExited) {
      change.stdin.write("ROLLBACK;\n\\q\n");
      await exited.catch(() => {});
    }
    dockerCompose([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "dropdb",
      "-U",
      "pguser",
      "--force",
      databaseName,
    ]);
  }
}

export type ReplacedAdminCredential =
  | "login-challenge"
  | "password-reset"
  | "totp-enrollment";

export async function staleCredentialReplacementRace(
  credential: ReplacedAdminCredential,
): Promise<{
  freshCredentialIntact: number;
  oldCredentialAccepted: number;
}> {
  const databaseName = `e2e_migration_${randomBytes(16).toString("hex")}`;
  const marker = `credential_replaced_${randomBytes(8).toString("hex")}`;
  const applicationName = `e2e_${credential.replaceAll("-", "_")}_${randomBytes(6).toString("hex")}`;
  const email = `${credential}@example.test`;
  const oldHash = "11";
  const newHash = "22";
  let setupSQL: string;
  let replacementSQL: string;
  let consumerSQL: string;
  let intactSQL: string;

  switch (credential) {
    case "password-reset":
      setupSQL = `
        INSERT INTO vetchium.admin_password_reset_tokens (
          admin_user_id, token_hash, expires_at
        ) SELECT admin_user_id, decode(repeat('${oldHash}', 32), 'hex'),
            now() + interval '30 minutes'
          FROM vetchium.admin_users WHERE email_address = ${sqlLiteral(email)};
      `;
      replacementSQL = `
        UPDATE vetchium.admin_password_reset_tokens
        SET token_hash = decode(repeat('${newHash}', 32), 'hex'),
            created_at = now(), expires_at = now() + interval '30 minutes'
        WHERE admin_user_id = (
          SELECT admin_user_id FROM vetchium.admin_users
          WHERE email_address = ${sqlLiteral(email)}
        );
      `;
      consumerSQL = `
        SELECT admin_user_id
        FROM vetchium.admin_password_reset_tokens
        WHERE token_hash = decode(repeat('${oldHash}', 32), 'hex')
          AND active AND consumed_at IS NULL AND expires_at > now();
        SELECT admin_user_id FROM vetchium.admin_users
        WHERE email_address = ${sqlLiteral(email)} FOR UPDATE;
        WITH token AS (
          SELECT t.admin_password_reset_token_id, t.admin_user_id
          FROM vetchium.admin_password_reset_tokens AS t
          JOIN vetchium.admin_users AS u USING (admin_user_id)
          WHERE t.token_hash = decode(repeat('${oldHash}', 32), 'hex')
            AND t.active AND t.consumed_at IS NULL AND t.expires_at > now()
            AND u.admin_user_state = 'active'
          FOR UPDATE OF t
        ), updated AS (
          UPDATE vetchium.admin_users
          SET password_hash = 'stale-consumer-password', updated_at = now()
          WHERE admin_user_id = (SELECT admin_user_id FROM token)
          RETURNING admin_user_id
        ), consumed AS (
          UPDATE vetchium.admin_password_reset_tokens
          SET consumed_at = now(), active = false
          WHERE admin_password_reset_token_id = (
            SELECT admin_password_reset_token_id FROM token
          ) AND EXISTS (SELECT 1 FROM updated)
          RETURNING 1
        )
        SELECT count(*) FROM consumed;
      `;
      intactSQL = `
        SELECT count(*)
        FROM vetchium.admin_password_reset_tokens AS t
        JOIN vetchium.admin_users AS u USING (admin_user_id)
        WHERE u.email_address = ${sqlLiteral(email)}
          AND u.password_hash = 'original-password-hash'
          AND t.token_hash = decode(repeat('${newHash}', 32), 'hex')
          AND t.active AND t.consumed_at IS NULL;
      `;
      break;
    case "login-challenge":
      setupSQL = `
        UPDATE vetchium.admin_users
        SET totp_secret_ciphertext = decode('01', 'hex'), totp_enabled = true
        WHERE email_address = ${sqlLiteral(email)};
        INSERT INTO vetchium.admin_login_challenges (
          admin_user_id, token_hash, expires_at
        ) SELECT admin_user_id, decode(repeat('${oldHash}', 32), 'hex'),
            now() + interval '5 minutes'
          FROM vetchium.admin_users WHERE email_address = ${sqlLiteral(email)};
      `;
      replacementSQL = `
        UPDATE vetchium.admin_login_challenges
        SET token_hash = decode(repeat('${newHash}', 32), 'hex'),
            created_at = now(), expires_at = now() + interval '5 minutes'
        WHERE admin_user_id = (
          SELECT admin_user_id FROM vetchium.admin_users
          WHERE email_address = ${sqlLiteral(email)}
        );
      `;
      consumerSQL = `
        SELECT admin_user_id
        FROM vetchium.admin_login_challenges
        WHERE token_hash = decode(repeat('${oldHash}', 32), 'hex')
          AND active AND consumed_at IS NULL AND expires_at > now();
        SELECT admin_user_id FROM vetchium.admin_users
        WHERE email_address = ${sqlLiteral(email)} FOR UPDATE;
        WITH challenge AS (
          SELECT c.admin_login_challenge_id
          FROM vetchium.admin_login_challenges AS c
          JOIN vetchium.admin_users AS u USING (admin_user_id)
          WHERE c.token_hash = decode(repeat('${oldHash}', 32), 'hex')
            AND c.active AND c.consumed_at IS NULL AND c.expires_at > now()
            AND u.admin_user_state = 'active' AND u.totp_enabled
          FOR UPDATE OF c
        ), consumed AS (
          UPDATE vetchium.admin_login_challenges
          SET consumed_at = now(), active = false
          WHERE admin_login_challenge_id IN (
            SELECT admin_login_challenge_id FROM challenge
          )
          RETURNING 1
        )
        SELECT count(*) FROM consumed;
      `;
      intactSQL = `
        SELECT count(*)
        FROM vetchium.admin_login_challenges AS c
        JOIN vetchium.admin_users AS u USING (admin_user_id)
        WHERE u.email_address = ${sqlLiteral(email)}
          AND c.token_hash = decode(repeat('${newHash}', 32), 'hex')
          AND c.active AND c.consumed_at IS NULL;
      `;
      break;
    case "totp-enrollment":
      setupSQL = `
        INSERT INTO vetchium.admin_totp_enrollments (
          admin_user_id, token_hash, secret_ciphertext, expires_at
        ) SELECT admin_user_id, decode(repeat('${oldHash}', 32), 'hex'),
            decode('01', 'hex'), now() + interval '10 minutes'
          FROM vetchium.admin_users WHERE email_address = ${sqlLiteral(email)};
      `;
      replacementSQL = `
        UPDATE vetchium.admin_totp_enrollments
        SET token_hash = decode(repeat('${newHash}', 32), 'hex'),
            secret_ciphertext = decode('02', 'hex'), created_at = now(),
            expires_at = now() + interval '10 minutes'
        WHERE admin_user_id = (
          SELECT admin_user_id FROM vetchium.admin_users
          WHERE email_address = ${sqlLiteral(email)}
        );
      `;
      consumerSQL = `
        SELECT admin_user_id
        FROM vetchium.admin_totp_enrollments
        WHERE token_hash = decode(repeat('${oldHash}', 32), 'hex')
          AND active AND consumed_at IS NULL AND expires_at > now();
        SELECT admin_user_id FROM vetchium.admin_users
        WHERE email_address = ${sqlLiteral(email)} FOR UPDATE;
        WITH enrollment AS (
          SELECT e.admin_totp_enrollment_id, e.admin_user_id,
              e.secret_ciphertext
          FROM vetchium.admin_totp_enrollments AS e
          JOIN vetchium.admin_users AS u USING (admin_user_id)
          WHERE e.token_hash = decode(repeat('${oldHash}', 32), 'hex')
            AND e.active AND e.consumed_at IS NULL AND e.expires_at > now()
            AND u.admin_user_state = 'active' AND NOT u.totp_enabled
          FOR UPDATE OF e
        ), updated AS (
          UPDATE vetchium.admin_users AS u
          SET totp_secret_ciphertext = enrollment.secret_ciphertext,
              totp_enabled = true, updated_at = now()
          FROM enrollment
          WHERE u.admin_user_id = enrollment.admin_user_id
          RETURNING 1
        )
        SELECT count(*) FROM updated;
      `;
      intactSQL = `
        SELECT count(*)
        FROM vetchium.admin_totp_enrollments AS e
        JOIN vetchium.admin_users AS u USING (admin_user_id)
        WHERE u.email_address = ${sqlLiteral(email)} AND NOT u.totp_enabled
          AND e.token_hash = decode(repeat('${newHash}', 32), 'hex')
          AND e.secret_ciphertext = decode('02', 'hex')
          AND e.active AND e.consumed_at IS NULL;
      `;
      break;
  }

  dockerCompose([
    "exec",
    "-T",
    "db-sgp",
    "env",
    "PGPASSWORD=pgpassword",
    "createdb",
    "-U",
    "pguser",
    databaseName,
  ]);
  runMigration(databaseName);
  const replacement = spawn(
    "docker",
    [
      "compose",
      "-f",
      resolve(repositoryRoot, "docker-compose-ci.json"),
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { cwd: repositoryRoot, stdio: ["pipe", "pipe", "pipe"] },
  );
  let replacementExited = false;
  let stdout = "";
  let stderr = "";
  replacement.stdout.setEncoding("utf8");
  replacement.stderr.setEncoding("utf8");
  replacement.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  replacement.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolvePromise, reject) => {
    replacement.once("error", reject);
    replacement.once("exit", (code) => {
      replacementExited = true;
      if (code === 0) resolvePromise();
      else
        reject(new Error(`credential replacement exited ${code}: ${stderr}`));
    });
  });
  try {
    const ready = new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `credential replacement was not ready: ${stdout} ${stderr}`,
            ),
          ),
        10_000,
      );
      const onData = () => {
        if (stdout.includes(marker)) {
          clearTimeout(timeout);
          replacement.stdout.off("data", onData);
          resolvePromise();
        }
      };
      replacement.stdout.on("data", onData);
      replacement.once("exit", () => {
        clearTimeout(timeout);
        reject(
          new Error(`credential replacement exited before ready: ${stderr}`),
        );
      });
    });
    replacement.stdin.write(`
      INSERT INTO vetchium.admin_users (
        email_address, display_name, password_hash
      ) VALUES (
        ${sqlLiteral(email)}, 'Credential Race', 'original-password-hash'
      );
      ${setupSQL}
      BEGIN;
      UPDATE vetchium.admin_users SET updated_at = now()
      WHERE email_address = ${sqlLiteral(email)};
      ${replacementSQL}
      SELECT '${marker}';
    `);
    await ready;

    const consumer = dockerComposeAsync([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      `PGAPPNAME=${applicationName}`,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-U",
      "pguser",
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `BEGIN; ${consumerSQL} COMMIT;`,
    ]);
    await waitForDatabaseLockWaiters(databaseName, [applicationName]);
    replacement.stdin.write("COMMIT;\n\\q\n");
    await exited;
    const consumerResult = await consumer;
    const lastResult = consumerResult.trim().split(/\s+/).at(-1);
    return {
      oldCredentialAccepted: Number(lastResult),
      freshCredentialIntact: Number(
        dockerCompose([
          "exec",
          "-T",
          "db-sgp",
          "env",
          "PGPASSWORD=pgpassword",
          "psql",
          "-U",
          "pguser",
          "-d",
          databaseName,
          "-v",
          "ON_ERROR_STOP=1",
          "-Atqc",
          intactSQL,
        ]),
      ),
    };
  } finally {
    if (!replacementExited) {
      replacement.stdin.write("ROLLBACK;\n\\q\n");
      await exited.catch(() => {});
    }
    dockerCompose([
      "exec",
      "-T",
      "db-sgp",
      "env",
      "PGPASSWORD=pgpassword",
      "dropdb",
      "-U",
      "pguser",
      "--force",
      databaseName,
    ]);
  }
}

export function sqlScalar(sql: string): string {
  return sqlScalarForTenant("sgp", sql);
}

export function cleanupAdmin(emailAddress: string): void {
  assertOwnedEmail(emailAddress);
  const email = sqlLiteral(emailAddress);
  sqlScalar(`
    DELETE FROM vetchium.admin_email_outbox WHERE recipient_email_address = ${email};
    DELETE FROM vetchium.admin_invitations WHERE email_address = ${email};
    DELETE FROM vetchium.admin_users WHERE email_address = ${email};
  `);
}

export function createAdminForPendingInvitation(emailAddress: string): void {
  assertOwnedEmail(emailAddress);
  sqlScalar(`
    INSERT INTO vetchium.admin_users (
      email_address, display_name, password_hash
    ) VALUES (
      ${sqlLiteral(emailAddress)}, 'Concurrent Setup', 'unused-test-hash'
    );
  `);
}

export function cleanupHubSignupDomain(
  domain: string,
  tenant: TestTenant = "sgp",
): void {
  assertOwnedDomain(domain);
  sqlScalarForTenant(
    tenant,
    `DELETE FROM vetchium.hub_signup_domains
     WHERE domain = ${sqlLiteral(domain)};`,
  );
}

export function cleanupAdminIdempotency(keys: Iterable<string>): void {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return;
  for (const key of uniqueKeys) {
    if (!/^e2e-[A-Za-z0-9_-]{22,124}$/.test(key)) {
      throw new Error(`refusing to delete non-test idempotency key: ${key}`);
    }
  }
  sqlScalar(`
    DELETE FROM vetchium.idempotency_ledger
    WHERE idempotency_key IN (${uniqueKeys.map(sqlLiteral).join(", ")});
  `);
}

export function ageAdminInvitation(emailAddress: string): void {
  assertOwnedEmail(emailAddress);
  sqlScalar(`
    UPDATE vetchium.admin_invitations
    SET created_at = now() - interval '2 days',
        expires_at = now() - interval '1 day'
    WHERE email_address = ${sqlLiteral(emailAddress)} AND active;
  `);
}

export function ageSession(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("refusing to age a malformed session token");
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  sqlScalar(`
    UPDATE vetchium.admin_sessions
    SET authenticated_at = now() - interval '6 minutes'
    WHERE session_token_hash = decode('${tokenHash}', 'hex');
  `);
}

export function ageAdminLastLogin(emailAddress: string): void {
  assertOwnedEmail(emailAddress);
  sqlScalar(`
    UPDATE vetchium.admin_users
    SET last_login_at = timestamp with time zone '2000-01-01 00:00:00+00'
    WHERE email_address = ${sqlLiteral(emailAddress)};
  `);
}

export function adminLastLoginAt(emailAddress: string): number {
  assertOwnedEmail(emailAddress);
  const value = sqlScalar(`
    SELECT extract(epoch FROM last_login_at)::text
    FROM vetchium.admin_users
    WHERE email_address = ${sqlLiteral(emailAddress)};
  `);
  return Number(value) * 1000;
}

export function sessionAndReplayExpiry(
  sessionToken: string,
  operation: string,
  key: string,
): { session: number; replay: number } {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    throw new Error("refusing to inspect a malformed session token");
  }
  if (!/^admin:[a-z-]+$/.test(operation) || !/^e2e-[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("refusing to inspect malformed idempotency identifiers");
  }
  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
  const value = sqlScalar(`
    SELECT
      extract(epoch FROM s.expires_at)::text || '|' ||
      extract(epoch FROM i.expires_at)::text
    FROM vetchium.admin_sessions AS s
    CROSS JOIN vetchium.idempotency_ledger AS i
    WHERE s.session_token_hash = decode('${tokenHash}', 'hex')
      AND i.operation = ${sqlLiteral(operation)}
      AND i.idempotency_key = ${sqlLiteral(key)};
  `);
  const parts = value.split("|").map(Number);
  const session = parts[0];
  const replay = parts[1];
  if (
    session === undefined ||
    replay === undefined ||
    !Number.isFinite(session) ||
    !Number.isFinite(replay)
  ) {
    throw new Error("session or replay expiry is unavailable");
  }
  return { session: session * 1000, replay: replay * 1000 };
}

export function adminIdempotencyCiphertextLength(
  operation: string,
  key: string,
): number | undefined {
  if (!/^admin:[a-z-]+$/.test(operation) || !/^e2e-[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("refusing to inspect malformed idempotency identifiers");
  }
  const value = sqlScalar(`
    SELECT octet_length(response_ciphertext)::text
    FROM vetchium.idempotency_ledger
    WHERE operation = ${sqlLiteral(operation)}
      AND idempotency_key = ${sqlLiteral(key)};
  `);
  return value === "" ? undefined : Number(value);
}

export function expireAdminIdempotency(operation: string, key: string): void {
  if (!/^admin:[a-z-]+$/.test(operation) || !/^e2e-[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error("refusing to expire malformed idempotency identifiers");
  }
  sqlScalar(`
    UPDATE vetchium.idempotency_ledger
    SET created_at = now() - interval '2 minutes',
        expires_at = now() - interval '1 minute'
    WHERE operation = ${sqlLiteral(operation)}
      AND idempotency_key = ${sqlLiteral(key)};
  `);
}

export function createSeededManagerSession(tenant: TestTenant = "sgp"): string {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const inserted = sqlScalarForTenant(
    tenant,
    `
    INSERT INTO vetchium.admin_sessions (
      admin_user_id, session_token_hash, authenticated_at, expires_at
    )
    SELECT admin_user_id, decode('${tokenHash}', 'hex'), now(), now() + interval '15 minutes'
    FROM vetchium.admin_users
    WHERE email_address = 'admin@${tenant}.example'
      AND EXISTS (
        SELECT 1 FROM vetchium.admin_permissions AS permission
        WHERE permission.admin_user_id = admin_users.admin_user_id
          AND permission.permission = 'admin:manage_users'
      )
    RETURNING admin_session_id;
  `,
  );
  if (inserted.length === 0) throw new Error("seeded manager is unavailable");
  return token;
}

/**
 * The seeded administrator of a tenant no other test touches. A tenant-wide
 * invariant such as keeping one administrator able to manage administrators
 * cannot be exercised where parallel tests create administrators of their own.
 */
export const ISOLATED_TENANT = "deu" satisfies TestTenant;

export function isolatedTenantBaseURL(): string {
  return `http://admin-ui.${ISOLATED_TENANT}.localhost`;
}

/** The permissions stored as grants, without the ones they imply. */
export function seededManagerGrants(tenant: TestTenant): string[] {
  const grants = sqlScalarForTenant(
    tenant,
    `SELECT permission FROM vetchium.admin_permissions AS p
     JOIN vetchium.admin_users AS u USING (admin_user_id)
     WHERE u.email_address = 'admin@${tenant}.example'
     ORDER BY permission;`,
  );
  return grants.length === 0 ? [] : grants.split("\n");
}

function credentialKey(): Buffer {
  const secret = process.env.ADMIN_CREDENTIAL_KEY ?? "dev_admin_credential_key";
  return createHash("sha256")
    .update(`vetchium-admin-credentials\0${tenantID}\0${secret}`)
    .digest();
}

function credentialSubkey(purpose: string): Buffer {
  return createHmac("sha256", credentialKey())
    .update(`vetchium-admin-subkey\0${purpose}`)
    .digest();
}

function decryptPayload(encodedCiphertext: string): Record<string, string> {
  const ciphertext = Buffer.from(
    encodedCiphertext.replaceAll(/\s/g, ""),
    "base64",
  );
  if (ciphertext[0] !== 1) {
    throw new Error("unsupported credential ciphertext version");
  }
  const nonce = ciphertext.subarray(1, 13);
  const authenticationTag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(13, ciphertext.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialSubkey("outbox"),
    nonce,
  );
  decipher.setAuthTag(authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
}

export function emailCredential(
  emailAddress: string,
  kind: "invitation" | "password-reset",
  property: "invitation_token" | "reset_token",
): string {
  assertOwnedEmail(emailAddress);
  const encoded = sqlScalar(`
    SELECT encode(payload_ciphertext, 'base64')
    FROM vetchium.admin_email_outbox
    WHERE recipient_email_address = ${sqlLiteral(emailAddress)}
      AND kind = ${sqlLiteral(kind)}
    ORDER BY created_at DESC, admin_email_outbox_id DESC
    LIMIT 1;
  `);
  if (encoded.length === 0) {
    throw new Error(`no ${kind} outbox item for ${emailAddress}`);
  }
  const value = decryptPayload(encoded)[property];
  if (value === undefined) {
    throw new Error(`${kind} payload did not contain ${property}`);
  }
  return value;
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentTOTP(secret: string, timestamp = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
