import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { registerEmailingDomainsCommand } from "../emailing-domains.command";

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

describe("emailing-domains command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerEmailingDomainsCommand(program);
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

  it("registers the emailing-domains command", () => {
    const command = program.commands.find((candidate) => candidate.name() === "emailing-domains");
    const deleteCmd = command?.commands.find((candidate) => candidate.name() === "delete");

    expect(command).toBeDefined();
    expect(command?.description()).toBe("Manage emailing domains");
    expect(command?.registeredArguments ?? []).toHaveLength(0);
    expect(command?.commands.map((candidate) => candidate.name())).toEqual([
      "list",
      "create",
      "verify",
      "delete",
    ]);
    expect(deleteCmd?.options.find((option) => option.long === "--yes")).toBeDefined();
  });

  it("lists emailing domains", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          getEmailingDomains: [
            {
              id: "domain-1",
              domain: "mail.example.com",
              driver: "AWS_SES",
              status: "PENDING",
              verificationRecords: [],
              createdAt: "2026-03-22T00:00:00.000Z",
              updatedAt: "2026-03-22T00:00:00.000Z",
              verifiedAt: null,
            },
          ],
        },
      },
    });

    await program.parseAsync(["node", "test", "emailing-domains", "list", "-o", "json", "--full"]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("getEmailingDomains"),
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed[0].domain).toBe("mail.example.com");
  });

  it("creates an emailing domain", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          createEmailingDomain: {
            id: "domain-1",
            domain: "mail.example.com",
            driver: "AWS_SES",
            status: "PENDING",
            verificationRecords: [
              {
                type: "TXT",
                key: "_amazonses.mail.example.com",
                value: "token",
                priority: null,
              },
            ],
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
            verifiedAt: null,
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "emailing-domains",
      "create",
      "--domain",
      "mail.example.com",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("createEmailingDomain"),
        variables: {
          domain: "mail.example.com",
          driver: "AWS_SES",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.driver).toBe("AWS_SES");
  });

  it("verifies an emailing domain", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          verifyEmailingDomain: {
            id: "domain-1",
            domain: "mail.example.com",
            driver: "AWS_SES",
            status: "VERIFIED",
            verificationRecords: [],
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
            verifiedAt: "2026-03-22T01:00:00.000Z",
          },
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "emailing-domains",
      "verify",
      "domain-1",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("verifyEmailingDomain"),
        variables: {
          id: "domain-1",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("VERIFIED");
  });

  it("deletes an emailing domain", async () => {
    mockPost.mockResolvedValue({
      data: {
        data: {
          deleteEmailingDomain: true,
        },
      },
    });

    await program.parseAsync([
      "node",
      "test",
      "emailing-domains",
      "delete",
      "domain-1",
      "--yes",
      "-o",
      "json",
      "--full",
    ]);

    expect(mockPost).toHaveBeenCalledWith(
      "/metadata",
      expect.objectContaining({
        query: expect.stringContaining("deleteEmailingDomain"),
        variables: {
          id: "domain-1",
        },
      }),
    );
    const output = consoleSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({
      success: true,
      id: "domain-1",
    });
  });

  it("requires --domain for create", async () => {
    await expect(
      program.parseAsync(["node", "test", "emailing-domains", "create"]),
    ).rejects.toThrow("Missing --domain option.");
  });

  it("requires --yes for delete", async () => {
    await expect(
      program.parseAsync(["node", "test", "emailing-domains", "delete", "domain-1"]),
    ).rejects.toMatchObject({
      message: "Delete requires --yes.",
      code: "INVALID_ARGUMENTS",
    });
  });
});
