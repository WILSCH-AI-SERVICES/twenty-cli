import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandContext } from "../../../utilities/shared/context";
import { registerDbCommand } from "../db.command";

const mockWithClient = vi.fn();
const mockClose = vi.fn();

vi.mock("../../../utilities/shared/context", () => ({
  createCommandContext: vi.fn(),
}));

vi.mock("../../../utilities/db/services/db-connection.service", () => ({
  DbConnectionService: vi.fn(
    function DbConnectionServiceMock(this: {
      withClient: typeof mockWithClient;
      close: typeof mockClose;
    }) {
      this.withClient = mockWithClient;
      this.close = mockClose;
    },
  ),
}));

describe("db command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let outputRender: ReturnType<typeof vi.fn>;
  let mockStatus: ReturnType<typeof vi.fn>;
  let mockDoctor: ReturnType<typeof vi.fn>;
  let mockListProfiles: ReturnType<typeof vi.fn>;
  let mockInitProfile: ReturnType<typeof vi.fn>;
  let mockGetProfile: ReturnType<typeof vi.fn>;
  let mockSetActiveProfile: ReturnType<typeof vi.fn>;
  let mockTest: ReturnType<typeof vi.fn>;
  let mockRefreshCreds: ReturnType<typeof vi.fn>;
  let mockRemoveProfile: ReturnType<typeof vi.fn>;
  let mockResolveWorkspace: ReturnType<typeof vi.fn>;
  let mockGetActiveProfile: ReturnType<typeof vi.fn>;
  let mockListObjects: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete process.env.TWENTY_DB_PROFILE;
    delete process.env.TWENTY_DATABASE_URL;
    delete process.env.TWENTY_DATABASE_SCHEMA;
    program = new Command();
    program.exitOverride();
    registerDbCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    outputRender = vi.fn();
    mockStatus = vi.fn();
    mockDoctor = vi.fn();
    mockListProfiles = vi.fn();
    mockInitProfile = vi.fn();
    mockGetProfile = vi.fn();
    mockSetActiveProfile = vi.fn();
    mockTest = vi.fn();
    mockRefreshCreds = vi.fn();
    mockRemoveProfile = vi.fn();
    mockResolveWorkspace = vi.fn().mockResolvedValue("default");
    mockGetActiveProfile = vi.fn().mockResolvedValue(undefined);
    mockListObjects = vi.fn();
    mockWithClient.mockReset();
    mockClose.mockReset();

    vi.mocked(createCommandContext).mockImplementation(() => ({
      globalOptions: {
        output: "json",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
      },
      services: {
        config: {} as never,
        api: {} as never,
        publicHttp: {} as never,
        search: {} as never,
        mcp: {} as never,
        records: {} as never,
        metadata: {
          listObjects: mockListObjects,
        } as never,
        output: {
          render: outputRender,
        } as never,
        importer: {} as never,
        exporter: {} as never,
        dbStatus: {
          getStatus: mockStatus,
          doctor: mockDoctor,
        } as never,
        dbProfiles: {
          listProfiles: mockListProfiles,
          initProfile: mockInitProfile,
          getProfile: mockGetProfile,
          setActiveProfile: mockSetActiveProfile,
          test: mockTest,
          refreshCreds: mockRefreshCreds,
          removeProfile: mockRemoveProfile,
          resolveWorkspace: mockResolveWorkspace,
          getActiveProfile: mockGetActiveProfile,
        } as never,
      },
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = undefined;
    delete process.env.TWENTY_DB_PROFILE;
    delete process.env.TWENTY_DATABASE_URL;
    delete process.env.TWENTY_DATABASE_SCHEMA;
    vi.clearAllMocks();
  });

  it("registers the db command family", () => {
    const command = program.commands.find((candidate) => candidate.name() === "db");
    const profile = command?.commands.find((candidate) => candidate.name() === "profile");
    const help = command?.helpInformation() ?? "";

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Manage db-first read profiles and diagnostics");
    expect(command?.commands.map((candidate) => candidate.name())).toEqual(
      expect.arrayContaining(["profile", "status", "doctor", "benchmark", "coverage"]),
    );
    expect(profile?.commands.map((candidate) => candidate.name())).toEqual(
      expect.arrayContaining(["init", "list", "show", "use", "test", "refresh-creds", "remove"]),
    );
    expect(help).toContain("profile");
    expect(help).toContain("status");
    expect(help).toContain("benchmark");
    expect(help).toContain("coverage");
  });

  it("db coverage renders the backend matrix as json", async () => {
    await program.parseAsync(["node", "test", "db", "coverage", "--output", "json"]);

    expect(outputRender).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            command: "db coverage",
            status: "local_only",
          }),
        ]),
        meta: expect.objectContaining({
          total: expect.any(Number),
        }),
      }),
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
  });

  it("db coverage --light renders compact rows", async () => {
    vi.mocked(createCommandContext).mockImplementationOnce(() => ({
      globalOptions: {
        output: "json",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
        light: true,
      },
      services: {
        output: {
          render: outputRender,
        } as never,
      } as never,
    }));

    await program.parseAsync(["node", "test", "db", "coverage", "--light"]);

    expect(outputRender).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          cmd: "db coverage",
          st: "local_only",
          pri: "P4",
        }),
      ]),
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
  });

  it("db coverage --agent-mode uses the same compact rows as --light", async () => {
    vi.mocked(createCommandContext).mockImplementationOnce(() => ({
      globalOptions: {
        output: "json",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
        agentMode: true,
        light: true,
      },
      services: {
        output: {
          render: outputRender,
        } as never,
      } as never,
    }));

    await program.parseAsync(["node", "test", "db", "coverage", "--agent-mode"]);

    expect(outputRender).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          cmd: "db coverage",
          st: "local_only",
          pri: "P4",
        }),
      ]),
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
  });

  it("db coverage -o markdown renders a table", async () => {
    vi.mocked(createCommandContext).mockImplementationOnce(() => ({
      globalOptions: {
        output: "markdown",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
      },
      services: {
        output: {
          render: outputRender,
        } as never,
      } as never,
    }));

    await program.parseAsync(["node", "test", "db", "coverage", "-o", "markdown"]);

    expect(outputRender).toHaveBeenCalledWith(
      expect.stringContaining("| command |"),
      expect.objectContaining({
        format: "markdown",
        query: undefined,
      }),
    );
  });

  it("db explain runs EXPLAIN ANALYZE for the resolved list query", async () => {
    mockGetActiveProfile.mockResolvedValue({
      name: "readonly",
      databaseUrl: "mock-db-url",
      databaseSchema: "workspace_test",
    });
    mockListObjects.mockResolvedValue([
      {
        id: "person-id",
        nameSingular: "person",
        namePlural: "people",
      },
    ]);
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ "QUERY PLAN": [{ Plan: { "Node Type": "Limit" }, "Execution Time": 1.25 }] }],
      }),
    };
    mockWithClient.mockImplementation(
      async (_options: unknown, fn: (c: typeof client) => unknown) => fn(client),
    );

    await program.parseAsync(["node", "test", "db", "explain", "--object", "people"]);

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(String(sql)).toContain("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)");
    expect(String(sql)).toContain('from "workspace_test"."person" as t');
    expect(params).toEqual([21]);
    expect(outputRender).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "db explain",
        variant: "list",
        object: "people",
        limit: 20,
        durationMs: expect.any(Number),
        plan: [{ Plan: { "Node Type": "Limit" }, "Execution Time": 1.25 }],
      }),
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("validates db benchmark iterations", async () => {
    await expect(
      program.parseAsync(["node", "test", "db", "benchmark", "--iterations", "0"]),
    ).rejects.toThrow("--iterations must be greater than 0.");
  });

  it("shows db status via the status service", async () => {
    mockStatus.mockResolvedValue({
      workspace: "prod",
      configured: true,
      mode: "db",
      profileName: "readonly",
    });

    await program.parseAsync(["node", "test", "db", "status"]);

    expect(mockStatus).toHaveBeenCalledWith({
      workspace: undefined,
      readSource: "auto",
    });
    expect(outputRender).toHaveBeenCalledWith(
      {
        workspace: "prod",
        configured: true,
        mode: "db",
        profileName: "readonly",
      },
      {
        format: "json",
        query: undefined,
      },
    );
  });

  it("shows db doctor diagnostics via the status service", async () => {
    mockDoctor.mockResolvedValue({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "profile",
      profileName: "readonly",
      databaseUrl: "postgresql://reader:***@db.example.com/twenty",
      ok: true,
      checkedAt: "2026-05-03T00:00:00.000Z",
      connection: { ok: true },
    });

    await program.parseAsync(["node", "test", "db", "doctor"]);

    expect(mockDoctor).toHaveBeenCalledWith({
      workspace: undefined,
      readSource: "auto",
    });
    expect(outputRender).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "prod",
        ok: true,
        databaseUrl: "postgresql://reader:***@db.example.com/twenty",
      }),
      {
        format: "json",
        query: undefined,
      },
    );
  });

  it("db doctor --strict sets a non-zero exit code when unhealthy", async () => {
    mockDoctor.mockResolvedValue({
      workspace: "prod",
      configured: false,
      mode: "api",
      source: "none",
      ok: false,
      checkedAt: "2026-05-03T00:00:00.000Z",
      connection: { ok: false },
    });

    await program.parseAsync(["node", "test", "db", "doctor", "--strict"]);

    expect(process.exitCode).toBe(1);
  });

  it("db doctor --light renders a compact summary", async () => {
    vi.mocked(createCommandContext).mockImplementationOnce(() => ({
      globalOptions: {
        output: "json",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
        light: true,
      },
      services: {
        output: {
          render: outputRender,
        } as never,
        dbStatus: {
          doctor: mockDoctor,
        } as never,
      } as never,
    }));
    mockDoctor.mockResolvedValue({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "profile",
      ok: true,
      effectiveSslmode: "require",
      warnings: ["check optional indexes"],
      resources: [{ name: "people", readable: true }],
      checkedAt: "2026-05-03T00:00:00.000Z",
      connection: { ok: true },
    });

    await program.parseAsync(["node", "test", "db", "doctor", "--light"]);

    expect(outputRender).toHaveBeenCalledWith(
      {
        ok: true,
        cfg: true,
        rch: true,
        ssl: "require",
        res: [{ name: "people", readable: true }],
        wrn: ["check optional indexes"],
      },
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
  });

  it("db doctor --agent-mode uses the same compact summary as --light", async () => {
    vi.mocked(createCommandContext).mockImplementationOnce(() => ({
      globalOptions: {
        output: "json",
        query: undefined,
        workspace: undefined,
        readSource: "auto",
        agentMode: true,
        light: true,
      },
      services: {
        output: {
          render: outputRender,
        } as never,
        dbStatus: {
          doctor: mockDoctor,
        } as never,
      } as never,
    }));
    mockDoctor.mockResolvedValue({
      workspace: "prod",
      configured: true,
      mode: "db",
      source: "profile",
      ok: true,
      effectiveSslmode: "require",
      warnings: [],
      resources: [{ name: "people", readable: true }],
      checkedAt: "2026-05-03T00:00:00.000Z",
      connection: { ok: true },
    });

    await program.parseAsync(["node", "test", "db", "doctor", "--agent-mode"]);

    expect(outputRender).toHaveBeenCalledWith(
      {
        ok: true,
        cfg: true,
        rch: true,
        ssl: "require",
        res: [{ name: "people", readable: true }],
      },
      expect.objectContaining({
        format: "json",
        query: undefined,
      }),
    );
  });

  it("prefers an explicit db profile name when showing a profile", async () => {
    mockGetProfile.mockResolvedValue({
      name: "explicit",
      workspace: "prod",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      credentialSource: "manual",
    });

    await program.parseAsync(["node", "test", "db", "profile", "show", "explicit"]);

    expect(mockGetProfile).toHaveBeenCalledWith(undefined, "explicit");
    expect(outputRender).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "explicit",
      }),
      expect.objectContaining({
        format: "json",
      }),
    );
  });

  it("falls back to TWENTY_DB_PROFILE when showing a profile", async () => {
    process.env.TWENTY_DB_PROFILE = "cached";
    mockGetProfile.mockResolvedValue({
      name: "cached",
      workspace: "prod",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      credentialSource: "manual",
    });

    await program.parseAsync(["node", "test", "db", "profile", "show"]);

    expect(mockGetProfile).toHaveBeenCalledWith(undefined, "cached");
  });

  it("falls back to the status profile when showing a profile", async () => {
    mockStatus.mockResolvedValue({
      workspace: "prod",
      configured: true,
      mode: "db",
      profileName: "status-profile",
    });
    mockGetProfile.mockResolvedValue({
      name: "status-profile",
      workspace: "prod",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      credentialSource: "manual",
    });

    await program.parseAsync(["node", "test", "db", "profile", "show"]);

    expect(mockStatus).toHaveBeenCalledWith({ workspace: undefined });
    expect(mockGetProfile).toHaveBeenCalledWith(undefined, "status-profile");
  });

  it("fails clearly when no profile can be resolved for show", async () => {
    mockStatus.mockResolvedValue({
      workspace: "prod",
      configured: false,
      mode: "api",
    });

    await expect(program.parseAsync(["node", "test", "db", "profile", "show"])).rejects.toThrow(
      "No DB profile selected.",
    );
  });

  it("initializes a db profile from a database URL", async () => {
    mockInitProfile.mockResolvedValue({
      name: "readonly",
      workspace: "default",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      credentialSource: "manual",
      notes: "seeded",
    });

    await program.parseAsync([
      "node",
      "test",
      "db",
      "profile",
      "init",
      "readonly",
      "--database-url",
      "postgresql://db.example.com:5432/twenty",
      "--notes",
      "seeded",
    ]);

    expect(mockInitProfile).toHaveBeenCalledWith({
      workspace: undefined,
      name: "readonly",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      notes: "seeded",
    });
    expect(outputRender).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "readonly",
        databaseUrl: "postgresql://db.example.com:5432/twenty",
        credentialSource: "manual",
        notes: "seeded",
      }),
      expect.objectContaining({
        format: "json",
      }),
    );
  });

  it("uses TWENTY_DATABASE_URL when initializing a db profile", async () => {
    process.env.TWENTY_DATABASE_URL = "postgresql://db.example.com:5432/twenty";
    mockInitProfile.mockResolvedValue({
      name: "cached",
      workspace: "default",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      credentialSource: "manual",
    });

    await program.parseAsync(["node", "test", "db", "profile", "init", "cached"]);

    expect(mockInitProfile).toHaveBeenCalledWith({
      workspace: undefined,
      name: "cached",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      notes: undefined,
    });
  });

  it("initializes a db profile with an explicit workspace schema", async () => {
    mockInitProfile.mockResolvedValue({
      name: "cached",
      workspace: "default",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      databaseSchema: "workspace_test",
      credentialSource: "manual",
    });

    await program.parseAsync([
      "node",
      "test",
      "db",
      "profile",
      "init",
      "cached",
      "--database-url",
      "postgresql://db.example.com:5432/twenty",
      "--database-schema",
      "workspace_test",
    ]);

    expect(mockInitProfile).toHaveBeenCalledWith({
      workspace: undefined,
      name: "cached",
      databaseUrl: "postgresql://db.example.com:5432/twenty",
      databaseSchema: "workspace_test",
      notes: undefined,
    });
  });

  it.each([
    {
      label: "init",
      command: [
        "db",
        "profile",
        "init",
        "prod",
        "--database-url",
        "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
      ],
      arrange: () => {
        mockInitProfile.mockResolvedValue(secretProfile());
      },
    },
    {
      label: "list",
      command: ["db", "profile", "list"],
      arrange: () => {
        mockListProfiles.mockResolvedValue([secretProfile()]);
      },
    },
    {
      label: "show",
      command: ["db", "profile", "show", "prod"],
      arrange: () => {
        mockGetProfile.mockResolvedValue(secretProfile());
      },
    },
    {
      label: "use",
      command: ["db", "profile", "use", "prod"],
      arrange: () => {
        mockSetActiveProfile.mockResolvedValue(secretProfile());
      },
    },
    {
      label: "test",
      command: ["db", "profile", "test", "prod"],
      arrange: () => {
        mockTest.mockResolvedValue(secretProfile());
      },
    },
    {
      label: "refresh-creds",
      command: ["db", "profile", "refresh-creds", "prod"],
      arrange: () => {
        mockRefreshCreds.mockResolvedValue(secretProfile());
      },
    },
  ])("redacts secrets in db profile $label output", async ({ command, arrange }) => {
    arrange();

    await program.parseAsync(["node", "test", ...command]);

    const rendered = outputRender.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(rendered)).not.toContain("secret");
    expect(JSON.stringify(rendered)).toContain("***");
  });
});

function secretProfile() {
  return {
    name: "prod",
    workspace: "demo",
    databaseUrl: "postgresql://reader:secret@db.example.com:5432/twenty?sslmode=require",
    credentialSource: "manual" as const,
    cachedPassword: "secret",
  };
}
