import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BuiltCliRunError, runNodeScript, runNodeScriptAsync } from "./process-runner";

describe("process runner", () => {
  it("applies timeoutMs to sync runs and preserves output context", () => {
    const fixturePath = writeSyncTimeoutFixture();

    let caughtError: unknown;

    try {
      runNodeScript(fixturePath, [], {
        timeoutMs: 250,
        throwOnNonZeroExit: true,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(BuiltCliRunError);
    expect((caughtError as BuiltCliRunError).result).toEqual({
      exitCode: null,
      stdout: "fixture-stdout\n",
      stderr: "fixture-stderr\n",
    });
    expect((caughtError as BuiltCliRunError).message).toMatch(
      /Built CLI exited with code null[\s\S]*stderr:\nfixture-stderr[\s\S]*stdout:\nfixture-stdout/,
    );
  });

  it("kills timed out child processes and preserves output context", async () => {
    const fixturePath = path.resolve(__dirname, "./fixtures/hanging-child.js");

    const error = await runNodeScriptAsync(fixturePath, [], {
      timeoutMs: 250,
      throwOnNonZeroExit: true,
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(BuiltCliRunError);
    expect(error.result).toEqual({
      exitCode: null,
      stdout: "fixture-stdout\n",
      stderr: "fixture-stderr\n",
    });
    expect(error.message).toMatch(
      /Built CLI exited with code null[\s\S]*stderr:\nfixture-stderr[\s\S]*stdout:\nfixture-stdout/,
    );
  });
});

function writeSyncTimeoutFixture(): string {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "twenty-process-runner-"));
  const fixturePath = path.join(fixtureDir, "sync-timeout-child.js");

  fs.writeFileSync(
    fixturePath,
    [
      'const fs = require("node:fs");',
      'fs.writeSync(1, "fixture-stdout\\n");',
      'fs.writeSync(2, "fixture-stderr\\n");',
      "setTimeout(() => process.exit(0), 500);",
    ].join("\n"),
    "utf-8",
  );

  return fixturePath;
}
