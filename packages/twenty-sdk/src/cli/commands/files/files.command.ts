import { createWriteStream } from "node:fs";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "path";

import { Command } from "commander";
import FormData from "form-data";
import fs from "fs-extra";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import { requestPublic } from "../../utilities/shared/request-transport";

interface FilesOptions {
  outputFile?: string;
  target?: string;
  folder?: string;
  token?: string;
  universalIdentifier?: string;
  workspaceId?: string;
  applicationId?: string;
  applicationUniversalIdentifier?: string;
  fileFolder?: string;
  filePath?: string;
  fieldMetadataId?: string;
  fieldMetadataUniversalIdentifier?: string;
  maxBytes?: string;
}

const endpoint = "/metadata";
const SUPPORTED_DOWNLOAD_FOLDERS = [
  "core-picture",
  "files-field",
  "workflow",
  "agent-chat",
  "app-tarball",
] as const;
const UPLOAD_TARGETS = [
  "ai-chat",
  "workflow",
  "field",
  "workspace-logo",
  "profile-picture",
  "app-tarball",
  "application-file",
] as const;
const APPLICATION_FILE_FOLDERS = {
  "built-logic-function": "BuiltLogicFunction",
  "built-front-component": "BuiltFrontComponent",
  "public-asset": "PublicAsset",
  source: "Source",
  dependencies: "Dependencies",
} as const;
const DEFAULT_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

type UploadTarget = (typeof UPLOAD_TARGETS)[number];

function normalizeUploadTarget(target?: string): UploadTarget {
  const normalized = target?.toLowerCase();

  if (!normalized) {
    throw new CliError(
      `Missing --target option. Expected one of: ${UPLOAD_TARGETS.join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  if (!UPLOAD_TARGETS.includes(normalized as UploadTarget)) {
    throw new CliError(
      `Unsupported --target "${target}". Expected one of: ${UPLOAD_TARGETS.join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  return normalized as UploadTarget;
}

function normalizeDownloadFolder(folder?: string): (typeof SUPPORTED_DOWNLOAD_FOLDERS)[number] {
  const normalized = folder?.toLowerCase();

  if (!normalized) {
    throw new CliError(
      "Download by file ID requires --folder and --token. You can also pass a full signed URL instead of an ID.",
      "INVALID_ARGUMENTS",
    );
  }

  if (
    !SUPPORTED_DOWNLOAD_FOLDERS.includes(normalized as (typeof SUPPORTED_DOWNLOAD_FOLDERS)[number])
  ) {
    throw new CliError(
      `Unsupported --folder "${folder}". Expected one of: ${SUPPORTED_DOWNLOAD_FOLDERS.join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  return normalized as (typeof SUPPORTED_DOWNLOAD_FOLDERS)[number];
}

function normalizeApplicationFileFolder(
  folder?: string,
): (typeof APPLICATION_FILE_FOLDERS)[keyof typeof APPLICATION_FILE_FOLDERS] {
  const normalized = folder?.toLowerCase();

  if (!normalized) {
    throw new CliError(
      `Application file uploads require --file-folder. Expected one of: ${Object.keys(APPLICATION_FILE_FOLDERS).join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  const graphqlFolder =
    APPLICATION_FILE_FOLDERS[normalized as keyof typeof APPLICATION_FILE_FOLDERS];

  if (!graphqlFolder) {
    throw new CliError(
      `Unsupported --file-folder "${folder}". Expected one of: ${Object.keys(APPLICATION_FILE_FOLDERS).join(", ")}.`,
      "INVALID_ARGUMENTS",
    );
  }

  return graphqlFolder;
}

function buildGraphqlUploadForm(
  query: string,
  variables: Record<string, unknown>,
  filePath: string,
): FormData {
  const form = new FormData();

  form.append(
    "operations",
    JSON.stringify({
      query,
      variables: {
        ...variables,
        file: null,
      },
    }),
  );
  form.append("map", JSON.stringify({ 0: ["variables.file"] }));
  form.append("0", fs.createReadStream(filePath), path.basename(filePath));

  return form;
}

function inferOutputPath(reference: string): string {
  let pathname = reference;

  try {
    pathname = new URL(reference).pathname;
  } catch {
    pathname = reference;
  }

  const cleanPath = pathname.split("?")[0] ?? pathname;
  const fileName = path.basename(cleanPath);

  return fileName || "download";
}

function toOutputBuffer(data: string | ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (typeof data === "string") {
    return Buffer.from(data);
  }

  return Buffer.from(new Uint8Array(data));
}

function parseMaxBytes(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_DOWNLOAD_MAX_BYTES;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliError("--max-bytes must be a positive integer.", "INVALID_ARGUMENTS");
  }

  return parsed;
}

function buildDownloadUrl(pathOrId: string, options: FilesOptions): string {
  if (pathOrId.startsWith("//")) {
    throw new CliError("Protocol-relative file URLs are not supported.", "INVALID_ARGUMENTS");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrId) && !/^https?:\/\//i.test(pathOrId)) {
    throw new CliError("File downloads only support HTTP(S) URLs.", "INVALID_ARGUMENTS");
  }
  if (
    pathOrId.startsWith("http://") ||
    pathOrId.startsWith("https://") ||
    pathOrId.startsWith("/file/") ||
    pathOrId.startsWith("/public-assets/")
  ) {
    return pathOrId;
  }

  const folder = normalizeDownloadFolder(options.folder);

  if (!options.token) {
    throw new CliError(
      "Download by file ID requires --token. You can also pass a full signed URL instead of an ID.",
      "INVALID_ARGUMENTS",
    );
  }

  return `/file/${folder}/${pathOrId}?token=${encodeURIComponent(options.token)}`;
}

async function assertAllowedDownloadUrl(
  services: Pick<Awaited<ReturnType<typeof createCommandContext>>["services"], "config">,
  workspace: string | undefined,
  requestPath: string,
  allowedPathPrefixes: string[],
): Promise<void> {
  if (requestPath.startsWith("//")) {
    throw new CliError("Protocol-relative file URLs are not supported.", "INVALID_ARGUMENTS");
  }

  if (!/^https?:\/\//i.test(requestPath)) {
    if (!allowedPathPrefixes.some((prefix) => requestPath.startsWith(prefix))) {
      throw new CliError(
        "File download path is outside the allowed Twenty file routes.",
        "INVALID_ARGUMENTS",
      );
    }
    return;
  }

  const url = new URL(requestPath);
  const resolved = await services.config.resolveApiConfig({ workspace, requireAuth: false });
  const apiOrigin = new URL(resolved.apiUrl).origin;

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("File downloads only support HTTP(S) URLs.", "INVALID_ARGUMENTS");
  }
  if (url.origin !== apiOrigin) {
    throw new CliError(
      "File download URL origin must match the configured Twenty API URL.",
      "INVALID_ARGUMENTS",
    );
  }
  if (!allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new CliError(
      "File download path is outside the allowed Twenty file routes.",
      "INVALID_ARGUMENTS",
    );
  }
}

async function writeDownloadData(
  outputPath: string,
  data: string | ArrayBuffer | Buffer | Readable,
  maxBytes: number,
): Promise<void> {
  const tempPath = buildTemporaryDownloadPath(outputPath);

  try {
    if (isReadableStream(data)) {
      await pipeline(data, createByteLimitTransform(maxBytes), createWriteStream(tempPath));
      await fs.move(tempPath, outputPath, { overwrite: true });
      return;
    }

    const buffer = toOutputBuffer(data);
    if (buffer.byteLength > maxBytes) {
      throw new CliError(`Download exceeded --max-bytes ${maxBytes}.`, "INVALID_ARGUMENTS");
    }
    await fs.writeFile(tempPath, buffer);
    await fs.move(tempPath, outputPath, { overwrite: true });
  } catch (error) {
    await fs.remove(tempPath);
    throw error;
  }
}

function buildTemporaryDownloadPath(outputPath: string): string {
  const directory = path.dirname(outputPath);
  const basename = path.basename(outputPath);

  return path.join(directory, `.${basename}.${process.pid}.${Date.now()}.part`);
}

function createByteLimitTransform(maxBytes: number): Transform {
  let bytes = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        callback(new CliError(`Download exceeded --max-bytes ${maxBytes}.`, "INVALID_ARGUMENTS"));
        return;
      }
      callback(null, chunk);
    },
  });
}

function isReadableStream(value: unknown): value is Readable {
  return Boolean(
    value && typeof value === "object" && typeof (value as Readable).pipe === "function",
  );
}

function buildPublicAssetUrl(assetPath: string, options: FilesOptions): string {
  if (!options.workspaceId) {
    throw new CliError("Missing --workspace-id option.", "INVALID_ARGUMENTS");
  }

  if (!options.applicationId) {
    throw new CliError("Missing --application-id option.", "INVALID_ARGUMENTS");
  }

  const normalizedPath = assetPath.replace(/^\/+/, "");

  return `/public-assets/${options.workspaceId}/${options.applicationId}/${normalizedPath}`;
}

function buildUploadMutation(
  target: UploadTarget,
  options: FilesOptions,
): {
  query: string;
  variables: Record<string, unknown>;
  resultKey: string;
} {
  switch (target) {
    case "ai-chat":
      return {
        query: `mutation UploadAIChatFile($file: Upload!) { uploadAIChatFile(file: $file) { id path size createdAt url } }`,
        variables: {},
        resultKey: "uploadAIChatFile",
      };
    case "workflow":
      return {
        query: `mutation UploadWorkflowFile($file: Upload!) { uploadWorkflowFile(file: $file) { id path size createdAt url } }`,
        variables: {},
        resultKey: "uploadWorkflowFile",
      };
    case "workspace-logo":
      return {
        query: `mutation UploadWorkspaceLogo($file: Upload!) { uploadWorkspaceLogo(file: $file) { url } }`,
        variables: {},
        resultKey: "uploadWorkspaceLogo",
      };
    case "profile-picture":
      return {
        query: `mutation UploadWorkspaceMemberProfilePicture($file: Upload!) { uploadWorkspaceMemberProfilePicture(file: $file) { url } }`,
        variables: {},
        resultKey: "uploadWorkspaceMemberProfilePicture",
      };
    case "app-tarball":
      return {
        query: `mutation UploadAppTarball($file: Upload!, $universalIdentifier: String) {
          uploadAppTarball(file: $file, universalIdentifier: $universalIdentifier) {
            id
            universalIdentifier
            name
          }
        }`,
        variables: {
          universalIdentifier: options.universalIdentifier ?? null,
        },
        resultKey: "uploadAppTarball",
      };
    case "application-file": {
      if (!options.applicationUniversalIdentifier) {
        throw new CliError(
          "Application file uploads require --application-universal-identifier.",
          "INVALID_ARGUMENTS",
        );
      }

      if (!options.filePath) {
        throw new CliError("Application file uploads require --file-path.", "INVALID_ARGUMENTS");
      }

      return {
        query: `mutation UploadApplicationFile(
          $file: Upload!
          $applicationUniversalIdentifier: String!
          $fileFolder: FileFolder!
          $filePath: String!
        ) {
          uploadApplicationFile(
            file: $file
            applicationUniversalIdentifier: $applicationUniversalIdentifier
            fileFolder: $fileFolder
            filePath: $filePath
          ) {
            id
            path
            size
            createdAt
            url
          }
        }`,
        variables: {
          applicationUniversalIdentifier: options.applicationUniversalIdentifier,
          fileFolder: normalizeApplicationFileFolder(options.fileFolder),
          filePath: options.filePath,
        },
        resultKey: "uploadApplicationFile",
      };
    }
    case "field": {
      if (options.fieldMetadataId && options.fieldMetadataUniversalIdentifier) {
        throw new CliError(
          "Provide only one of --field-metadata-id or --field-metadata-universal-identifier.",
          "INVALID_ARGUMENTS",
        );
      }

      if (options.fieldMetadataId) {
        return {
          query: `mutation UploadFilesFieldFile($file: Upload!, $fieldMetadataId: String!) { uploadFilesFieldFile(file: $file, fieldMetadataId: $fieldMetadataId) { id path size createdAt url } }`,
          variables: { fieldMetadataId: options.fieldMetadataId },
          resultKey: "uploadFilesFieldFile",
        };
      }

      if (options.fieldMetadataUniversalIdentifier) {
        return {
          query: `mutation UploadFilesFieldFileByUniversalIdentifier($file: Upload!, $fieldMetadataUniversalIdentifier: String!) { uploadFilesFieldFileByUniversalIdentifier(file: $file, fieldMetadataUniversalIdentifier: $fieldMetadataUniversalIdentifier) { id path size createdAt url } }`,
          variables: {
            fieldMetadataUniversalIdentifier: options.fieldMetadataUniversalIdentifier,
          },
          resultKey: "uploadFilesFieldFileByUniversalIdentifier",
        };
      }

      throw new CliError(
        "Field uploads require --field-metadata-id or --field-metadata-universal-identifier.",
        "INVALID_ARGUMENTS",
      );
    }
  }
}

function getFilesOptions(command: Command): FilesOptions {
  return command.opts() as FilesOptions;
}

async function runUploadCommand(filePath: string | undefined, command: Command): Promise<void> {
  const { globalOptions, services } = await createCommandContext(command);
  const options = getFilesOptions(command);

  if (!filePath) {
    throw new CliError("Missing file path.", "INVALID_ARGUMENTS");
  }
  if (!(await fs.pathExists(filePath))) {
    throw new CliError(`File not found: ${filePath}`, "INVALID_ARGUMENTS");
  }

  const target = normalizeUploadTarget(options.target);
  const { query, variables, resultKey } = buildUploadMutation(target, options);
  const form = buildGraphqlUploadForm(query, variables, filePath);
  const response = await services.api.post<GraphQLResponse<Record<string, unknown>>>(
    endpoint,
    form,
    {
      headers: form.getHeaders(),
    },
  );
  const uploadResult = requireGraphqlField(
    response.data ?? {},
    resultKey,
    `Failed to upload file ${filePath}.`,
  );

  await services.output.render(uploadResult, {
    format: globalOptions.output,
    query: globalOptions.query,
  });
}

async function runDownloadCommand(pathOrId: string | undefined, command: Command): Promise<void> {
  const { globalOptions, services } = await createCommandContext(command);
  const options = getFilesOptions(command);

  if (!pathOrId) {
    throw new CliError("Missing file ID or signed URL.", "INVALID_ARGUMENTS");
  }

  const downloadUrl = buildDownloadUrl(pathOrId, options);
  await assertAllowedDownloadUrl(services, globalOptions.workspace, downloadUrl, ["/file/"]);
  const outputPath = options.outputFile || inferOutputPath(downloadUrl);
  const maxBytes = parseMaxBytes(options.maxBytes);
  const response = await requestPublic<Readable>(services, {
    authMode: "none",
    method: "get",
    path: downloadUrl,
    responseType: "stream",
  });

  await writeDownloadData(outputPath, response.data, maxBytes);
  // eslint-disable-next-line no-console
  console.log(`Downloaded to ${outputPath}`);
}

async function runPublicAssetCommand(
  assetPath: string | undefined,
  command: Command,
): Promise<void> {
  const { globalOptions, services } = await createCommandContext(command);
  const options = getFilesOptions(command);

  if (!assetPath) {
    throw new CliError("Missing public asset path.", "INVALID_ARGUMENTS");
  }

  const assetUrl = buildPublicAssetUrl(assetPath, options);
  await assertAllowedDownloadUrl(services, globalOptions.workspace, assetUrl, ["/public-assets/"]);
  const outputPath = options.outputFile || inferOutputPath(assetPath);
  const maxBytes = parseMaxBytes(options.maxBytes);
  const response = await requestPublic<Readable>(services, {
    authMode: "none",
    method: "get",
    path: assetUrl,
    responseType: "stream",
  });

  await writeDownloadData(outputPath, response.data, maxBytes);
  // eslint-disable-next-line no-console
  console.log(`Downloaded to ${outputPath}`);
}

export function registerFilesCommand(program: Command): void {
  const files = program
    .command("files")
    .description("Upload and download files through verified Twenty file APIs");
  applyGlobalOptions(files);

  const uploadCmd = files
    .command("upload")
    .description("Upload a file")
    .argument("[path-or-id]", "Local file path");
  uploadCmd
    .option(
      "--target <target>",
      "Upload target: ai-chat, workflow, field, workspace-logo, profile-picture, app-tarball, application-file",
    )
    .option("--universal-identifier <id>", "Optional universal identifier for app tarball uploads")
    .option(
      "--application-universal-identifier <id>",
      "Application universal identifier for application-file uploads",
    )
    .option(
      "--file-folder <folder>",
      "Application file folder: built-logic-function, built-front-component, public-asset, source, dependencies",
    )
    .option("--file-path <path>", "Remote application file path for application-file uploads")
    .option("--field-metadata-id <id>", "Field metadata ID for field uploads")
    .option(
      "--field-metadata-universal-identifier <id>",
      "Field metadata universal identifier for field uploads",
    );
  applyGlobalOptions(uploadCmd);
  uploadCmd.action(async (filePath: string | undefined, _options: unknown, command: Command) => {
    await runUploadCommand(filePath, command);
  });

  const downloadCmd = files
    .command("download")
    .description("Download a file")
    .argument("[path-or-id]", "Signed URL or file ID")
    .option("--output-file <path>", "Output file path")
    .option("--max-bytes <bytes>", "Maximum download size in bytes")
    .option(
      "--folder <folder>",
      "Signed file folder: core-picture, files-field, workflow, agent-chat, app-tarball",
    )
    .option("--token <token>", "Signed file token for /file downloads");
  applyGlobalOptions(downloadCmd);
  downloadCmd.action(async (pathOrId: string | undefined, _options: unknown, command: Command) => {
    await runDownloadCommand(pathOrId, command);
  });

  const publicAssetCmd = files
    .command("public-asset")
    .description("Download a public asset")
    .argument("[path-or-id]", "Public asset path")
    .option("--output-file <path>", "Output file path")
    .option("--max-bytes <bytes>", "Maximum download size in bytes")
    .option("--workspace-id <id>", "Workspace ID for public asset downloads")
    .option("--application-id <id>", "Application ID for public asset downloads");
  applyGlobalOptions(publicAssetCmd);
  publicAssetCmd.action(
    async (assetPath: string | undefined, _options: unknown, command: Command) => {
      await runPublicAssetCommand(assetPath, command);
    },
  );
}
