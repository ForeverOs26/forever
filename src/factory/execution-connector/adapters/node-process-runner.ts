import { spawn } from "node:child_process";

import {
  CLAUDE_CLI_BINARY,
  type ProcessRunResult,
  type ProcessRunner,
} from "./claude-code-adapter";

/**
 * Concrete node process runner for the real Claude Code adapter.
 *
 * This is the only connector module that touches `node:child_process`. It is
 * imported solely by gated live proving, never by unit tests, so the tested
 * code paths stay hermetic. Arguments are passed as an argv array (no shell),
 * so task-controlled values never enter a shell command string. The child's
 * stdout/stderr are captured; a hard timeout kills the process group.
 *
 * The environment is inherited so host-managed Claude authentication is used;
 * no credential is constructed, logged, or placed on the command line.
 */
export function createNodeProcessRunner(binary: string = CLAUDE_CLI_BINARY): ProcessRunner {
  return (argv, opts) =>
    new Promise<ProcessRunResult>((resolve) => {
      const child = spawn(binary, [...argv], {
        cwd: opts.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ exitCode: null, timedOut, stdout, stderr: `${stderr}${error.message}` });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, timedOut, stdout, stderr });
      });
    });
}
