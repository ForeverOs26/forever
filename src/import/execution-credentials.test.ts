import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_REDACTION_MARKER,
  createEnvExecutionCredentialProvider,
  EXECUTION_DATABASE_URL_ENV_VAR,
  ExecutionCredentialError,
  looksLikeApiKey,
  parseExecutorDatabaseUrl,
} from "./execution-credentials";
import { CANONICAL_SUPABASE_PROJECT_REF } from "./execution-endpoint";

const PASSWORD = "hermetic-not-a-real-password";
const CANONICAL_DB_URL = `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres`;
const CANONICAL_POOLER_URL = `postgresql://forever_import_executor.abtvsrcnfwlbawvrjeed:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const SERVICE_ROLE_KEY = "sb_secret_hermetic_test_value_only";

/** Env object that records every key read. */
function recordingEnv(values: Record<string, string | undefined>) {
  const reads: string[] = [];
  const env = new Proxy(values, {
    get(target, property) {
      if (typeof property === "string") reads.push(property);
      return target[property as string];
    },
  });
  return { env, reads };
}

function credentialCode(rawUrl: string): string | null {
  try {
    parseExecutorDatabaseUrl(rawUrl);
    return null;
  } catch (error) {
    return error instanceof ExecutionCredentialError ? error.code : "unexpected";
  }
}

describe("RC5.5D execution credential boundary (dedicated database principal)", () => {
  it("reads no environment variable at provider creation time", () => {
    const { env, reads } = recordingEnv({ [EXECUTION_DATABASE_URL_ENV_VAR]: CANONICAL_DB_URL });
    createEnvExecutionCredentialProvider(env);
    expect(reads).toEqual([]);
  });

  it("NEVER reads SUPABASE_SERVICE_ROLE_KEY, even during resolution", () => {
    const { env, reads } = recordingEnv({
      [EXECUTION_DATABASE_URL_ENV_VAR]: CANONICAL_DB_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      SUPABASE_URL: "https://abtvsrcnfwlbawvrjeed.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_hermetic",
    });
    const provider = createEnvExecutionCredentialProvider(env);
    provider.resolveExecutionCredentials();
    expect(reads).toContain(EXECUTION_DATABASE_URL_ENV_VAR);
    expect(reads).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(reads).not.toContain("SUPABASE_URL");
    expect(reads).not.toContain("SUPABASE_PUBLISHABLE_KEY");
  });

  it("fails closed when the dedicated execution credential is absent", () => {
    for (const values of [
      {},
      { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY },
      { [EXECUTION_DATABASE_URL_ENV_VAR]: "" },
    ]) {
      const provider = createEnvExecutionCredentialProvider(values);
      const failure = (() => {
        try {
          provider.resolveExecutionCredentials();
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(failure).toBeInstanceOf(ExecutionCredentialError);
      expect((failure as ExecutionCredentialError).code).toBe("execution_credentials_missing");
    }
  });

  it("rejects Supabase API keys, JWTs, and HTTPS URLs as execution credentials", () => {
    expect(looksLikeApiKey(SERVICE_ROLE_KEY)).toBe(true);
    expect(looksLikeApiKey("sb_publishable_abc")).toBe(true);
    expect(looksLikeApiKey("eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBe(true);
    expect(looksLikeApiKey(CANONICAL_DB_URL)).toBe(false);

    for (const value of [
      SERVICE_ROLE_KEY,
      "sb_publishable_abc",
      "eyJhbGciOiJIUzI1NiJ9.payload.sig",
      "https://abtvsrcnfwlbawvrjeed.supabase.co",
      "https://db.abtvsrcnfwlbawvrjeed.supabase.co",
    ]) {
      const provider = createEnvExecutionCredentialProvider({
        [EXECUTION_DATABASE_URL_ENV_VAR]: value,
      });
      expect(() => provider.resolveExecutionCredentials()).toThrowError(
        new ExecutionCredentialError("execution_credentials_invalid"),
      );
    }
  });

  it("rejects a connection URL for any role other than the dedicated executor", () => {
    for (const role of ["postgres", "service_role", "authenticator", "anon"]) {
      expect(
        credentialCode(
          `postgresql://${role}:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres`,
        ),
      ).toBe("execution_credentials_invalid");
    }
  });

  it("rejects malformed, foreign-host, and structurally deviant connection URLs", () => {
    for (const raw of [
      "",
      "not a url",
      // non-postgres scheme
      `mysql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co/postgres`,
      // missing password
      "postgresql://forever_import_executor@db.abtvsrcnfwlbawvrjeed.supabase.co/postgres",
      // non-canonical / deceptive host forms
      `postgresql://forever_import_executor:${PASSWORD}@abtvsrcnfwlbawvrjeed.supabase.co/postgres`,
      `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co.evil.com/postgres`,
      `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres?sslmode=disable`,
      `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres#x`,
      // wrong port
      `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:6543/postgres`,
      // wrong database
      `postgresql://forever_import_executor:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/app`,
      // whitespace / CRLF variants
      ` ${CANONICAL_DB_URL}`,
      `${CANONICAL_DB_URL}\n`,
    ]) {
      expect(credentialCode(raw)).toBe("execution_credentials_invalid");
    }
  });

  it("parses a valid direct-route executor URL into a non-secret identity", () => {
    const identity = parseExecutorDatabaseUrl(CANONICAL_DB_URL);
    expect(identity).toEqual({
      mode: "direct",
      role: "forever_import_executor",
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      host: "db.abtvsrcnfwlbawvrjeed.supabase.co",
      port: 5432,
      database: "postgres",
      region: null,
      origin:
        "postgres://forever_import_executor@db.abtvsrcnfwlbawvrjeed.supabase.co:5432/postgres",
    });
    // A non-canonical but well-formed ref still parses (identity check is the
    // endpoint verifier's job); the password never appears in the identity.
    const other = parseExecutorDatabaseUrl(
      `postgres://forever_import_executor:${PASSWORD}@db.zzzzzzzzzzzzzzzzzzzz.supabase.co/postgres`,
    );
    expect(other.projectRef).toBe("zzzzzzzzzzzzzzzzzzzz");
    expect(other.mode).toBe("direct");
    expect(JSON.stringify(other)).not.toContain(PASSWORD);
  });

  it("cannot leak the connection string/password through JSON, spread, or coercion", () => {
    const credentials = createEnvExecutionCredentialProvider({
      [EXECUTION_DATABASE_URL_ENV_VAR]: CANONICAL_DB_URL,
    }).resolveExecutionCredentials();

    expect(credentials.identity.projectRef).toBe(CANONICAL_SUPABASE_PROJECT_REF);
    expect(credentials.identity.role).toBe("forever_import_executor");

    expect(JSON.stringify(credentials)).not.toContain(PASSWORD);
    expect(JSON.stringify({ credentials })).not.toContain(PASSWORD);
    expect(Object.keys(credentials)).not.toContain("connectionString");
    expect(JSON.stringify({ ...credentials })).not.toContain(PASSWORD);
    expect(String(credentials)).toBe(CREDENTIAL_REDACTION_MARKER);
    expect(`${credentials}`).not.toContain(PASSWORD);
  });

  it("carries no connection material in its failure surfaces", () => {
    const provider = createEnvExecutionCredentialProvider({
      [EXECUTION_DATABASE_URL_ENV_VAR]: `postgresql://service_role:${PASSWORD}@db.abtvsrcnfwlbawvrjeed.supabase.co/postgres`,
    });
    try {
      provider.resolveExecutionCredentials();
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe("execution_credentials_invalid");
      expect(JSON.stringify(error)).not.toContain(PASSWORD);
      expect(JSON.stringify(error)).not.toContain("service_role");
    }
  });
});

describe("RC5.5D execution credential boundary: IPv4 Supavisor session route", () => {
  const POOLER_USER = `forever_import_executor.abtvsrcnfwlbawvrjeed`;
  function poolerUrl(user: string, host = "aws-0-us-east-1.pooler.supabase.com", port = "5432") {
    return `postgresql://${user}:${PASSWORD}@${host}:${port}/postgres`;
  }

  it("parses the exact canonical session-pooler form, deriving role and ref independently", () => {
    const identity = parseExecutorDatabaseUrl(CANONICAL_POOLER_URL);
    expect(identity).toEqual({
      mode: "supavisor_session",
      role: "forever_import_executor",
      projectRef: CANONICAL_SUPABASE_PROJECT_REF,
      host: "aws-0-us-east-1.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      region: "us-east-1",
      origin:
        "postgres://forever_import_executor.abtvsrcnfwlbawvrjeed@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    });
    // Role is the fixed prefix; ref is the username suffix, not the host.
    expect(identity.role).toBe("forever_import_executor");
    expect(identity.projectRef).toBe("abtvsrcnfwlbawvrjeed");
  });

  it("accepts multiple valid regions and AWS pooler indexes", () => {
    for (const [host, region] of [
      ["aws-0-us-east-1.pooler.supabase.com", "us-east-1"],
      ["aws-1-ap-southeast-1.pooler.supabase.com", "ap-southeast-1"],
      ["aws-0-eu-central-1.pooler.supabase.com", "eu-central-1"],
    ] as const) {
      const identity = parseExecutorDatabaseUrl(poolerUrl(POOLER_USER, host));
      expect(identity.mode).toBe("supavisor_session");
      expect(identity.region).toBe(region);
      expect(identity.projectRef).toBe(CANONICAL_SUPABASE_PROJECT_REF);
    }
  });

  it("rejects the TRANSACTION-mode pooler port 6543 and a missing port", () => {
    expect(
      credentialCode(poolerUrl(POOLER_USER, "aws-0-us-east-1.pooler.supabase.com", "6543")),
    ).toBe("execution_credentials_invalid");
    expect(
      credentialCode(
        `postgresql://${POOLER_USER}:${PASSWORD}@aws-0-us-east-1.pooler.supabase.com/postgres`,
      ),
    ).toBe("execution_credentials_invalid");
  });

  it("rejects arbitrary, deceptive, and non-pooler hosts", () => {
    for (const host of [
      "aws-0-us-east-1.pooler.supabase.com.evil.com",
      "evil-aws-0-us-east-1.pooler.supabase.com",
      "aws-0-us-east-1.pooler.supabase.co",
      "pooler.supabase.com",
      "aws-0-us-east-1.pooler.evil.com",
    ]) {
      expect(credentialCode(poolerUrl(POOLER_USER, host))).toBe("execution_credentials_invalid");
    }
  });

  it("rejects a malformed or foreign username form on the pooler route", () => {
    for (const user of [
      "forever_import_executor", // missing .<ref> tenant suffix
      "service_role.abtvsrcnfwlbawvrjeed", // foreign role
      "postgres.abtvsrcnfwlbawvrjeed",
      "forever_import_executor.TOOSHORT",
      "forever_import_executor.abtvsrcnfwlbawvrjeed.extra",
    ]) {
      expect(credentialCode(poolerUrl(user))).toBe("execution_credentials_invalid");
    }
  });

  it("parses a foreign-project pooler ref (endpoint verifier rejects it later)", () => {
    const identity = parseExecutorDatabaseUrl(
      poolerUrl("forever_import_executor.zzzzzzzzzzzzzzzzzzzz"),
    );
    expect(identity.projectRef).toBe("zzzzzzzzzzzzzzzzzzzz");
    expect(JSON.stringify(identity)).not.toContain(PASSWORD);
  });

  it("never leaks the pooler password through the resolved credential", () => {
    const credentials = createEnvExecutionCredentialProvider({
      [EXECUTION_DATABASE_URL_ENV_VAR]: CANONICAL_POOLER_URL,
    }).resolveExecutionCredentials();
    expect(credentials.identity.mode).toBe("supavisor_session");
    expect(credentials.identity.region).toBe("us-east-1");
    expect(JSON.stringify(credentials)).not.toContain(PASSWORD);
    expect(String(credentials)).toBe(CREDENTIAL_REDACTION_MARKER);
  });
});
