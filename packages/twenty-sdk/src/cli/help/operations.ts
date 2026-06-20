import { Command } from "commander";

import { HelpMetadata, HelpOperation, HelpOperationMetadata } from "./types";

export function getHelpOperations(
  command: Command,
  commandKey: string,
  metadata: HelpMetadata,
): HelpOperation[] {
  const parsedOperations = parseOperationsFromArguments(command.registeredArguments ?? []) ?? [];
  const sourceOperations = mergeOperationMetadata(parsedOperations, metadata.operations ?? []);

  return sourceOperations.map((operation) => ({
    name: operation.name,
    summary: operation.summary ?? summarizeOperation(commandKey, operation.name),
    mutates: operation.mutates ?? inferMutation(operation.name),
  }));
}

export function mergeOperationMetadata(
  parsedOperations: HelpOperationMetadata[],
  metadataOperations: HelpOperationMetadata[],
): HelpOperationMetadata[] {
  if (parsedOperations.length === 0) {
    return metadataOperations;
  }

  if (metadataOperations.length === 0) {
    return parsedOperations;
  }

  const metadataByName = new Map(
    metadataOperations.map((operation) => [operation.name, operation]),
  );
  const merged = parsedOperations.map((operation) => ({
    ...operation,
    ...metadataByName.get(operation.name),
  }));

  for (const operation of metadataOperations) {
    if (!merged.some((candidate) => candidate.name === operation.name)) {
      merged.push(operation);
    }
  }

  return merged;
}

export function parseOperationsFromArguments(
  argumentsList: ReadonlyArray<{ name(): string; description?: string }>,
): HelpOperationMetadata[] | undefined {
  const operationArgument = argumentsList.find((argument) => argument.name() === "operation");
  if (!operationArgument?.description) {
    return undefined;
  }

  const normalized = operationArgument.description.replace(/\bor\b/gi, ",");
  const operations = normalized
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[a-z][a-z0-9-]*$/i.test(value));

  if (operations.length === 0) {
    return undefined;
  }

  return operations.map((name) => ({ name }));
}

export function summarizeOperation(commandKey: string, operation: string): string {
  const parts = commandKey.split(" ");
  const resource = humanizeResource(parts[parts.length - 1] ?? "resource");
  const singularResource = singularizeResource(resource);

  switch (operation) {
    case "list":
      return `List ${resource}`;
    case "get":
      return `Get one ${singularResource}`;
    case "create":
      return `Create ${indefiniteArticle(singularResource)} ${singularResource}`;
    case "update":
      return `Update ${indefiniteArticle(singularResource)} ${singularResource}`;
    case "delete":
      return `Delete ${indefiniteArticle(singularResource)} ${singularResource}`;
    case "activate":
      return `Activate ${indefiniteArticle(singularResource)} ${singularResource}`;
    case "deactivate":
      return `Deactivate ${indefiniteArticle(singularResource)} ${singularResource}`;
    default:
      return operation.replace(/-/g, " ");
  }
}

export function humanizeResource(resource: string): string {
  return resource.replace(/-/g, " ");
}

export function singularizeResource(resource: string): string {
  if (resource.endsWith("ies")) {
    return `${resource.slice(0, -3)}y`;
  }

  if (resource.endsWith("ss")) {
    return resource;
  }

  if (resource.endsWith("s")) {
    return resource.slice(0, -1);
  }

  return resource;
}

export function indefiniteArticle(resource: string): "a" | "an" {
  return /^[aeiou]/i.test(resource) ? "an" : "a";
}

export function inferMutation(operation: string): boolean {
  const readOnlyOperations = new Set([
    "discover",
    "find-duplicates",
    "get",
    "group-by",
    "list",
    "packages",
    "query",
    "schema",
    "search",
    "source",
    "status",
    "validate",
    "workspace",
  ]);

  return !readOnlyOperations.has(operation);
}
