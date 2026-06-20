import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { registerPublicDomainsCommand } from "../public-domains.command";

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/config/services/config.service", () => ({
  ConfigService: vi.fn(function MockConfigService() {
    return {
      getConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-token",
        workspace: "default",
      }),
    };
  }),
}));

describe("public-domains command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerPublicDomainsCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            post: mockPost,
            get: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
            request: vi.fn(),
          }) as unknown as ApiService,
      ),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("registers the public-domains command", () => {
    const command = program.commands.find((candidate) => candidate.name() === "public-domains");
    const deleteCmd = command?.commands.find((candidate) => candidate.name() === "delete");

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Manage public domains");
    expect(command?.registeredArguments ?? []).toHaveLength(0);
    expect(command?.commands.map((candidate) => candidate.name())).toEqual([
      "list",
      "create",
      "delete",
      "check-records",
    ]);
    expect(deleteCmd?.options.find((option) => option.long === "--yes")).toBeDefined();
  });

  it("lists public domains", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          findManyPublicDomains: [
            {
              id: "domain-1",
              domain: "app.example.com",
              isValidated: true,
              createdAt: "2026-03-22T00:00:00.000Z",
            },
          ],
        },
      },
    });

    await program.parseAsync(["node", "test", "public-domains", "list", "-o", "json", "--full"]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("findManyPublicDomains"),
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed[0].domain).toBe("app.example.com");
  });

  it("creates a public domain", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          createPublicDomain: {
            id: "domain-1",
            domain: "app.example.com",
            isValidated: false,
            createdAt: "2026-03-22T00:00:00.000Z",
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "public-domains",
      "create",
      "--domain",
      "app.example.com",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("createPublicDomain"),
        variables: {
          domain: "app.example.com",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.domain).toBe("app.example.com");
  });

  it("deletes a public domain", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          deletePublicDomain: true,
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "public-domains",
      "delete",
      "--domain",
      "app.example.com",
      "--yes",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("deletePublicDomain"),
        variables: {
          domain: "app.example.com",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      success: true,
      domain: "app.example.com",
    });
  });

  it("checks public domain DNS records", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          checkPublicDomainValidRecords: {
            id: "domain-1",
            domain: "app.example.com",
            records: [
              {
                validationType: "ssl",
                type: "cname",
                status: "VALID",
                key: "_acme",
                value: "target.example.com",
              },
            ],
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "public-domains",
      "check-records",
      "--domain",
      "app.example.com",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("checkPublicDomainValidRecords"),
        variables: {
          domain: "app.example.com",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].key).toBe("_acme");
  });

  it("requires --domain for create", async () => {
    await expect(program.parseAsync(["node", "test", "public-domains", "create"])).rejects.toThrow(
      "Missing --domain option.",
    );
  });

  it("requires --yes for delete", async () => {
    await expect(
      program.parseAsync([
        "node",
        "test",
        "public-domains",
        "delete",
        "--domain",
        "app.example.com",
      ]),
    ).rejects.toMatchObject({
      message: "Delete requires --yes.",
      code: "INVALID_ARGUMENTS",
    });
  });
});
