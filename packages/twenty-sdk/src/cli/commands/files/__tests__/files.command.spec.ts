import { Command } from "commander";
import FormData from "form-data";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockConstructor } from "../../../test-utils/mock-constructor";
import { ApiService } from "../../../utilities/api/services/api.service";
import { PublicHttpService } from "../../../utilities/api/services/public-http.service";
import { CliError } from "../../../utilities/errors/cli-error";
import { registerFilesCommand } from "../files.command";

vi.mock("../../../utilities/api/services/api.service");
vi.mock("../../../utilities/api/services/public-http.service");
vi.mock("../../../utilities/config/services/config.service", () => ({
  ConfigService: vi.fn(function MockConfigService() {
    return {
      getConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-token",
        workspace: "default",
      }),
      resolveApiConfig: vi.fn().mockResolvedValue({
        apiUrl: "https://api.twenty.com",
        apiKey: "test-token",
        workspace: "default",
      }),
    };
  }),
}));
vi.mock("fs-extra");
vi.mock("form-data");

describe("files command", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockPublicRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerFilesCommand(program);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockPost = vi.fn();
    mockGet = vi.fn();
    mockPublicRequest = vi.fn();
    vi.mocked(ApiService).mockImplementation(
      mockConstructor(
        () =>
          ({
            post: mockPost,
            get: mockGet,
            put: vi.fn(),
            patch: vi.fn(),
            delete: vi.fn(),
            request: vi.fn(),
          }) as unknown as ApiService,
      ),
    );
    vi.mocked(PublicHttpService).mockImplementation(
      mockConstructor(
        () =>
          ({
            request: mockPublicRequest,
            client: {
              request: mockPublicRequest,
            },
          }) as unknown as PublicHttpService,
      ),
    );
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.move).mockResolvedValue(undefined as never);
    vi.mocked(fs.remove).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe("command registration", () => {
    it("registers files command with correct name and description", () => {
      const filesCmd = program.commands.find((cmd) => cmd.name() === "files");
      expect(filesCmd).toBeDefined();
      expect(filesCmd?.description()).toBe(
        "Upload and download files through verified Twenty file APIs",
      );
      expect(filesCmd?.registeredArguments ?? []).toHaveLength(0);

      const subcommands = filesCmd?.commands.map((cmd) => cmd.name()) ?? [];
      const help = filesCmd?.helpInformation() ?? "";

      expect(subcommands).toEqual(expect.arrayContaining(["upload", "download", "public-asset"]));
      expect(help).toContain("Commands:");
      expect(help).toContain("upload");
      expect(help).toContain("download");
      expect(help).toContain("public-asset");
    });

    it("registers explicit subcommands with scoped arguments and options", () => {
      const filesCmd = program.commands.find((cmd) => cmd.name() === "files");
      const uploadCmd = filesCmd?.commands.find((cmd) => cmd.name() === "upload");
      const downloadCmd = filesCmd?.commands.find((cmd) => cmd.name() === "download");
      const publicAssetCmd = filesCmd?.commands.find((cmd) => cmd.name() === "public-asset");

      expect(uploadCmd?.registeredArguments.map((arg) => arg.name())).toEqual(["path-or-id"]);
      expect(downloadCmd?.registeredArguments.map((arg) => arg.name())).toEqual(["path-or-id"]);
      expect(publicAssetCmd?.registeredArguments.map((arg) => arg.name())).toEqual(["path-or-id"]);
      expect(uploadCmd?.options.find((o) => o.long === "--target")).toBeDefined();
      expect(downloadCmd?.options.find((o) => o.long === "--folder")).toBeDefined();
      expect(downloadCmd?.options.find((o) => o.long === "--token")).toBeDefined();
      expect(publicAssetCmd?.options.find((o) => o.long === "--workspace-id")).toBeDefined();
      expect(publicAssetCmd?.options.find((o) => o.long === "--application-id")).toBeDefined();
    });

    it("has upload and download options", () => {
      const filesCmd = program.commands.find((cmd) => cmd.name() === "files");
      const uploadCmd = filesCmd?.commands.find((cmd) => cmd.name() === "upload");
      const downloadCmd = filesCmd?.commands.find((cmd) => cmd.name() === "download");
      const publicAssetCmd = filesCmd?.commands.find((cmd) => cmd.name() === "public-asset");
      const uploadOpts = uploadCmd?.options ?? [];
      const downloadOpts = downloadCmd?.options ?? [];
      const publicAssetOpts = publicAssetCmd?.options ?? [];
      expect(downloadOpts.find((o) => o.long === "--output-file")).toBeDefined();
      expect(downloadOpts.find((o) => o.long === "--max-bytes")).toBeDefined();
      expect(uploadOpts.find((o) => o.long === "--target")).toBeDefined();
      expect(downloadOpts.find((o) => o.long === "--folder")).toBeDefined();
      expect(downloadOpts.find((o) => o.long === "--token")).toBeDefined();
      expect(publicAssetOpts.find((o) => o.long === "--workspace-id")).toBeDefined();
      expect(publicAssetOpts.find((o) => o.long === "--application-id")).toBeDefined();
      expect(publicAssetOpts.find((o) => o.long === "--max-bytes")).toBeDefined();
      expect(uploadOpts.find((o) => o.long === "--field-metadata-id")).toBeDefined();
      expect(
        uploadOpts.find((o) => o.long === "--field-metadata-universal-identifier"),
      ).toBeDefined();
    });

    it("has global options applied", () => {
      const filesCmd = program.commands.find((cmd) => cmd.name() === "files");
      const uploadCmd = filesCmd?.commands.find((cmd) => cmd.name() === "upload");
      const opts = uploadCmd?.options ?? [];
      expect(opts.find((o) => o.long === "--output")).toBeDefined();
      expect(opts.find((o) => o.long === "--query")).toBeDefined();
      expect(opts.find((o) => o.long === "--workspace")).toBeDefined();
    });
  });

  describe("upload operation", () => {
    function mockUploadForm() {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);
      vi.mocked(fs.createReadStream).mockReturnValue({ pipe: vi.fn() } as never);

      const mockFormData = {
        append: vi.fn(),
        getHeaders: vi.fn().mockReturnValue({ "content-type": "multipart/form-data" }),
      };
      vi.mocked(FormData).mockImplementation(
        mockConstructor(() => mockFormData as unknown as FormData),
      );

      return mockFormData;
    }

    it("uploads an AI chat file through metadata GraphQL", async () => {
      const mockFormData = mockUploadForm();
      const uploadResponse = {
        id: "file-123",
        path: "agent-chat/file-123/test.txt",
        size: 1024,
        createdAt: "2026-03-21T11:00:00.000Z",
        url: "https://api.twenty.com/file/agent-chat/file-123?token=signed",
      };
      mockPost.mockResolvedValue({ data: { data: { uploadAIChatFile: uploadResponse } } });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "upload",
        "/path/to/test.txt",
        "--target",
        "ai-chat",
        "-o",
        "json",
        "--full",
      ]);

      expect(fs.pathExists).toHaveBeenCalledWith("/path/to/test.txt");
      expect(fs.createReadStream).toHaveBeenCalledWith("/path/to/test.txt");
      expect(mockFormData.append).toHaveBeenCalledWith("0", expect.anything(), "test.txt");

      const operationsCall = mockFormData.append.mock.calls.find(([name]) => name === "operations");
      const operations = JSON.parse(operationsCall?.[1] as string) as {
        query: string;
        variables: Record<string, unknown>;
      };

      expect(operations.query).toContain("uploadAIChatFile");
      expect(operations.variables).toEqual({ file: null });

      const mapCall = mockFormData.append.mock.calls.find(([name]) => name === "map");
      expect(JSON.parse(mapCall?.[1] as string)).toEqual({ 0: ["variables.file"] });

      expect(mockPost).toHaveBeenCalledWith("/metadata", mockFormData, {
        headers: { "content-type": "multipart/form-data" },
      });

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(JSON.parse(output).id).toBe("file-123");
    });

    it("uploads a files-field attachment by metadata id", async () => {
      const mockFormData = mockUploadForm();
      mockPost.mockResolvedValue({
        data: {
          data: {
            uploadFilesFieldFile: {
              id: "file-456",
              path: "files-field/file-456/report.pdf",
              size: 2048,
              createdAt: "2026-03-21T11:00:00.000Z",
              url: "https://api.twenty.com/file/files-field/file-456?token=signed",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "upload",
        "/path/to/report.pdf",
        "--target",
        "field",
        "--field-metadata-id",
        "field-123",
        "-o",
        "json",
        "--full",
      ]);

      const operationsCall = mockFormData.append.mock.calls.find(([name]) => name === "operations");
      const operations = JSON.parse(operationsCall?.[1] as string) as {
        query: string;
        variables: Record<string, unknown>;
      };

      expect(operations.query).toContain("uploadFilesFieldFile");
      expect(operations.variables).toEqual({
        fieldMetadataId: "field-123",
        file: null,
      });
    });

    it("uploads an application tarball", async () => {
      const mockFormData = mockUploadForm();
      mockPost.mockResolvedValue({
        data: {
          data: {
            uploadAppTarball: {
              id: "reg-123",
              universalIdentifier: "com.example.widget",
              name: "Widget App",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "upload",
        "/path/to/app.tar.gz",
        "--target",
        "app-tarball",
        "--universal-identifier",
        "com.example.widget",
        "-o",
        "json",
        "--full",
      ]);

      const operationsCall = mockFormData.append.mock.calls.find(([name]) => name === "operations");
      const operations = JSON.parse(operationsCall?.[1] as string) as {
        query: string;
        variables: Record<string, unknown>;
      };

      expect(operations.query).toContain("uploadAppTarball");
      expect(operations.variables).toEqual({
        file: null,
        universalIdentifier: "com.example.widget",
      });
    });

    it("uploads an application development file", async () => {
      const mockFormData = mockUploadForm();
      mockPost.mockResolvedValue({
        data: {
          data: {
            uploadApplicationFile: {
              id: "file-789",
              path: "public-assets/com.example.widget/images/logo.svg",
              size: 512,
              createdAt: "2026-03-23T11:00:00.000Z",
              url: "https://api.twenty.com/file/public-assets/file-789?token=signed",
            },
          },
        },
      });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "upload",
        "/path/to/logo.svg",
        "--target",
        "application-file",
        "--application-universal-identifier",
        "com.example.widget",
        "--file-folder",
        "public-asset",
        "--file-path",
        "images/logo.svg",
        "-o",
        "json",
        "--full",
      ]);

      const operationsCall = mockFormData.append.mock.calls.find(([name]) => name === "operations");
      const operations = JSON.parse(operationsCall?.[1] as string) as {
        query: string;
        variables: Record<string, unknown>;
      };

      expect(operations.query).toContain("uploadApplicationFile");
      expect(operations.variables).toEqual({
        applicationUniversalIdentifier: "com.example.widget",
        file: null,
        fileFolder: "PublicAsset",
        filePath: "images/logo.svg",
      });
    });

    it("throws when the upload target is missing", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);

      await expect(
        program.parseAsync(["node", "test", "files", "upload", "/path/to/test.txt"]),
      ).rejects.toThrow(CliError);
    });

    it("throws when a field upload is missing its identifier", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);

      await expect(
        program.parseAsync([
          "node",
          "test",
          "files",
          "upload",
          "/path/to/test.txt",
          "--target",
          "field",
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws when an application file upload is missing required metadata", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true as never);

      await expect(
        program.parseAsync([
          "node",
          "test",
          "files",
          "upload",
          "/path/to/test.txt",
          "--target",
          "application-file",
          "--application-universal-identifier",
          "com.example.widget",
        ]),
      ).rejects.toThrow(CliError);
    });

    it("throws when the file does not exist", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as never);

      await expect(
        program.parseAsync([
          "node",
          "test",
          "files",
          "upload",
          "/nonexistent/file.txt",
          "--target",
          "workflow",
        ]),
      ).rejects.toThrow("File not found: /nonexistent/file.txt");
    });
  });

  describe("download operation", () => {
    it("downloads a file from a signed URL", async () => {
      const fileContent = Buffer.from("file content");
      mockPublicRequest.mockResolvedValue({ data: fileContent });
      mockGet.mockResolvedValue({ data: fileContent });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "download",
        "https://api.twenty.com/file/files-field/file-123?token=signed-token",
      ]);

      expect(mockPublicRequest).toHaveBeenCalledWith({
        authMode: "none",
        method: "get",
        path: "https://api.twenty.com/file/files-field/file-123?token=signed-token",
        responseType: "stream",
      });
      expect(mockGet).not.toHaveBeenCalled();
      const tempPath = vi.mocked(fs.writeFile).mock.calls[0]?.[0];
      expect(tempPath).toEqual(expect.stringContaining(".file-123."));
      expect(fs.writeFile).toHaveBeenCalledWith(tempPath, fileContent);
      expect(fs.move).toHaveBeenCalledWith(tempPath, "file-123", { overwrite: true });
      expect(consoleSpy).toHaveBeenCalledWith("Downloaded to file-123");
    });

    it("downloads a file by id, folder, and token", async () => {
      const fileContent = Buffer.from("file content");
      mockPublicRequest.mockResolvedValue({ data: fileContent });
      mockGet.mockResolvedValue({ data: fileContent });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "download",
        "file-123",
        "--folder",
        "files-field",
        "--token",
        "signed-token",
        "--output-file",
        "/downloads/report.pdf",
      ]);

      expect(mockPublicRequest).toHaveBeenCalledWith({
        authMode: "none",
        method: "get",
        path: "/file/files-field/file-123?token=signed-token",
        responseType: "stream",
      });
      expect(mockGet).not.toHaveBeenCalled();
      const tempPath = vi.mocked(fs.writeFile).mock.calls[0]?.[0];
      expect(tempPath).toEqual(expect.stringContaining("/downloads/.report.pdf."));
      expect(fs.writeFile).toHaveBeenCalledWith(tempPath, fileContent);
      expect(fs.move).toHaveBeenCalledWith(tempPath, "/downloads/report.pdf", { overwrite: true });
      expect(consoleSpy).toHaveBeenCalledWith("Downloaded to /downloads/report.pdf");
    });

    it("throws when download by id is missing folder or token", async () => {
      await expect(
        program.parseAsync(["node", "test", "files", "download", "file-123"]),
      ).rejects.toThrow(CliError);
    });

    it("rejects signed URLs from a different origin", async () => {
      const offOriginSignedUrl = [
        "https",
        "://",
        "evil.example.com",
        "/file/files-field/file-123?token=signed-token",
      ].join("");

      await expect(
        program.parseAsync(["node", "test", "files", "download", offOriginSignedUrl]),
      ).rejects.toThrow("origin must match");
    });

    it("removes partial downloads when max bytes is exceeded", async () => {
      mockPublicRequest.mockResolvedValue({ data: Buffer.from("too large") });

      await expect(
        program.parseAsync([
          "node",
          "test",
          "files",
          "download",
          "https://api.twenty.com/file/files-field/file-123?token=signed-token",
          "--output-file",
          "/downloads/file-123",
          "--max-bytes",
          "4",
        ]),
      ).rejects.toThrow("Download exceeded --max-bytes 4.");

      const removedPath = vi.mocked(fs.remove).mock.calls[0]?.[0];
      expect(removedPath).toEqual(expect.stringContaining("/downloads/.file-123."));
      expect(removedPath).not.toBe("/downloads/file-123");
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.move).not.toHaveBeenCalled();
    });
  });

  describe("public asset operation", () => {
    it("downloads a public asset", async () => {
      const fileContent = Buffer.from("asset content");
      mockPublicRequest.mockResolvedValue({ data: fileContent });
      mockGet.mockResolvedValue({ data: fileContent });

      await program.parseAsync([
        "node",
        "test",
        "files",
        "public-asset",
        "images/logo.svg",
        "--workspace-id",
        "ws-123",
        "--application-id",
        "app-123",
      ]);

      expect(mockPublicRequest).toHaveBeenCalledWith({
        authMode: "none",
        method: "get",
        path: "/public-assets/ws-123/app-123/images/logo.svg",
        responseType: "stream",
      });
      expect(mockGet).not.toHaveBeenCalled();
      const tempPath = vi.mocked(fs.writeFile).mock.calls[0]?.[0];
      expect(tempPath).toEqual(expect.stringContaining(".logo.svg."));
      expect(fs.writeFile).toHaveBeenCalledWith(tempPath, fileContent);
      expect(fs.move).toHaveBeenCalledWith(tempPath, "logo.svg", { overwrite: true });
      expect(consoleSpy).toHaveBeenCalledWith("Downloaded to logo.svg");
    });

    it("requires workspace and application ids", async () => {
      await expect(
        program.parseAsync(["node", "test", "files", "public-asset", "images/logo.svg"]),
      ).rejects.toThrow(CliError);
    });
  });

  describe("unsupported operations", () => {
    it("rejects unsupported router-era commands as unknown subcommands", async () => {
      await expect(program.parseAsync(["node", "test", "files", "list"])).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });

    it("rejects delete as an unknown subcommand", async () => {
      await expect(
        program.parseAsync(["node", "test", "files", "delete", "file-123"]),
      ).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });
  });

  describe("error handling", () => {
    it("requires operation argument", async () => {
      await expect(program.parseAsync(["node", "test", "files"])).rejects.toThrow();
    });

    it("throws for unknown operations", async () => {
      await expect(
        program.parseAsync(["node", "test", "files", "unknown", "some-id"]),
      ).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });

    it("rejects mixed-case router-era operations as unknown subcommands", async () => {
      await expect(
        program.parseAsync([
          "node",
          "test",
          "files",
          "DOWNLOAD",
          "https://api.twenty.com/file/files-field/file-123?token=signed-token",
        ]),
      ).rejects.toMatchObject({
        code: "commander.unknownCommand",
      });
    });
  });
});
