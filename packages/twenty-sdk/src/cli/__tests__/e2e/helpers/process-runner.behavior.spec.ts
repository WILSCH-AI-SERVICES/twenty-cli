import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();
const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
  spawn: spawnMock,
}));

describe("process runner child-process branches", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    spawnMock.mockReset();
  });

  it("throws checked non-zero sync failures with output context", async () => {
    spawnSyncMock.mockReturnValue({
      status: 3,
      stdout: "partial output",
      stderr: "Missing API token.",
    });

    const { runNodeScript } = await import("./process-runner");

    expect(() =>
      runNodeScript("/tmp/process-runner-fixture.js", ["openapi", "core"], {
        throwOnNonZeroExit: true,
      }),
    ).toThrowError(
      /Built CLI exited with code 3[\s\S]*stderr:\nMissing API token\.[\s\S]*stdout:\npartial output/,
    );
  });

  it("waits for close so output emitted after exit is retained", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const { runNodeScriptAsync } = await import("./process-runner");
    const pendingResult = runNodeScriptAsync("/tmp/process-runner-fixture.js", ["auth", "status"], {
      timeoutMs: 250,
    });

    child.stdout.emit("data", Buffer.from("before-exit "));
    child.emit("exit", 0);
    child.stdout.emit("data", Buffer.from("after-exit"));
    child.stderr.emit("data", Buffer.from("late-stderr"));
    child.emit("close", 0);

    await expect(pendingResult).resolves.toEqual({
      exitCode: 0,
      stdout: "before-exit after-exit",
      stderr: "late-stderr",
    });
  });
});

function createMockChildProcess(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new EventEmitter() as ChildProcessWithoutNullStreams["stdout"];
  child.stderr = new EventEmitter() as ChildProcessWithoutNullStreams["stderr"];
  child.kill = vi.fn(() => true);

  return child;
}
