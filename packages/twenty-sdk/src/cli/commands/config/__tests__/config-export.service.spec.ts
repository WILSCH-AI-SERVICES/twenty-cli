import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { CliError } from "../../../utilities/errors/cli-error";
import {
  buildConfigExportDocument,
  collectMetadataPages,
  CONFIG_EXPORT_FORMAT,
  countEmbedded,
  OMITTED_KINDS,
  readMetadataTotalCount,
  runConfigExport,
  serializeConfigExport,
  type ConfigExportApi,
} from "../config-export.service";
import { registerConfigCommand } from "../config.command";

type Page = { data: unknown[]; totalCount?: number; pageInfo?: Record<string, unknown> };

function pagedApi(
  pagesByPath: Record<string, Page[]>,
  roles: unknown[] = [],
): ConfigExportApi & {
  calls: Array<{ url: string; params?: Record<string, string> }>;
} {
  const calls: Array<{ url: string; params?: Record<string, string> }> = [];

  return {
    calls,
    async get<T>(url: string, config?: { params?: Record<string, string> }) {
      calls.push({ url, params: config?.params });
      const pages = pagesByPath[url] ?? [];
      const cursor = config?.params?.starting_after;
      const index = cursor ? Number(cursor.replace("cursor-", "")) : 0;
      const page = pages[index] ?? { data: [] };

      return { data: page as T };
    },
    async post<T>(url: string) {
      expect(url).toBe("/metadata");

      return { data: { data: { getRoles: roles } } as T };
    },
  };
}

describe("config export service", () => {
  it("walks every page by cursor and keeps the server's order", async () => {
    const api = pagedApi({
      "/rest/metadata/things": [
        {
          data: [{ id: "b" }, { id: "a" }],
          totalCount: 3,
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        },
        { data: [{ id: "c" }], totalCount: 3, pageInfo: { hasNextPage: false } },
      ],
    });

    const collection = await collectMetadataPages(api, "/rest/metadata/things", "things", 2);

    expect(collection.items.map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(collection.totalCount).toBe(3);
    expect(collection.pages).toBe(2);
    expect(api.calls[0]?.params).toEqual({ limit: "2" });
    expect(api.calls[1]?.params).toEqual({ limit: "2", starting_after: "cursor-1" });
  });

  it("refuses a short export when the rows collected disagree with totalCount", async () => {
    const api = pagedApi({
      "/rest/metadata/fields": [
        { data: [{ id: "a" }, { id: "b" }], totalCount: 589, pageInfo: { hasNextPage: false } },
      ],
    });

    await expect(collectMetadataPages(api, "/rest/metadata/fields", "fields")).rejects.toThrow(
      /returned 2 rows but reports totalCount 589/,
    );
  });

  it("refuses to loop when the server says there is another page but gives no cursor", async () => {
    const api = pagedApi({
      "/rest/metadata/views": [{ data: [{ id: "a" }], pageInfo: { hasNextPage: true } }],
    });

    await expect(collectMetadataPages(api, "/rest/metadata/views", "views")).rejects.toThrow(
      CliError,
    );
  });

  it("reads totalCount with a one-row page", async () => {
    const api = pagedApi({
      "/rest/metadata/fields": [{ data: [{ id: "a" }], totalCount: 42 }],
    });

    expect(await readMetadataTotalCount(api, "/rest/metadata/fields")).toBe(42);
    expect(api.calls[0]?.params).toEqual({ limit: "1" });
  });

  it("counts embedded collections and names what it omits", () => {
    const document = buildConfigExportDocument({
      objects: [
        { id: "o1", fields: [{ id: "f1" }, { id: "f2" }] },
        { id: "o2", fields: [] },
      ],
      views: [
        {
          id: "v1",
          viewFields: [{ id: "vf1" }],
          viewFilters: [{ id: "vfl1" }, { id: "vfl2" }],
          viewGroups: [],
          viewSorts: [{ id: "vs1" }],
        },
      ],
      roles: [
        { id: "r1", permissionFlags: [{ id: "p1" }], objectPermissions: [], fieldPermissions: [] },
      ],
    });

    expect(document.format).toBe(CONFIG_EXPORT_FORMAT);
    expect(document.carries).toEqual({
      objects: 2,
      fields: 2,
      views: 1,
      viewFields: 1,
      viewFilters: 2,
      viewFilterGroups: 0,
      viewGroups: 0,
      viewSorts: 1,
      roles: 1,
      permissionFlags: 1,
      objectPermissions: 0,
      fieldPermissions: 0,
    });
    expect(document.omits.map((entry) => entry.kind)).toEqual(
      OMITTED_KINDS.map((entry) => entry.kind),
    );
    expect(countEmbedded([{ nothing: 1 }], "fields")).toBe(0);
  });

  it("serialises identically for identical input, without reordering keys", () => {
    const build = () =>
      buildConfigExportDocument({
        objects: [{ id: "o1", zeta: 1, alpha: 2, fields: [{ id: "f2" }, { id: "f1" }] }],
        views: [],
        roles: [],
      });

    const first = serializeConfigExport(build());
    const second = serializeConfigExport(build());

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.indexOf('"zeta"')).toBeLessThan(first.indexOf('"alpha"'));
    expect(first.indexOf('"f2"')).toBeLessThan(first.indexOf('"f1"'));
  });

  it("assembles the document from objects, views and roles, cross-checking the fields total", async () => {
    const api = pagedApi(
      {
        "/rest/metadata/objects": [
          {
            data: [{ id: "o1", fields: [{ id: "f1" }] }],
            totalCount: 1,
            pageInfo: { hasNextPage: false },
          },
        ],
        "/rest/metadata/fields": [{ data: [{ id: "f1" }], totalCount: 1 }],
        "/rest/metadata/views": [
          { data: [{ id: "v1", viewFields: [] }], totalCount: 1, pageInfo: { hasNextPage: false } },
        ],
      },
      [{ id: "r1", label: "Admin", permissionFlags: [] }],
    );

    const { document, text } = await runConfigExport(api);

    expect(document.carries.objects).toBe(1);
    expect(document.carries.roles).toBe(1);
    expect(JSON.parse(text)).toEqual(document);
  });

  it("refuses when the embedded fields disagree with the fields totalCount", async () => {
    const api = pagedApi({
      "/rest/metadata/objects": [
        {
          data: [{ id: "o1", fields: [{ id: "f1" }] }],
          totalCount: 1,
          pageInfo: { hasNextPage: false },
        },
      ],
      "/rest/metadata/fields": [{ data: [{ id: "f1" }], totalCount: 7 }],
    });

    await expect(runConfigExport(api)).rejects.toThrow(/embed 1 fields but .* totalCount 7/);
  });
});

describe("config command", () => {
  it("registers `config export` with the output-file option", () => {
    const program = new Command();
    program.exitOverride();
    registerConfigCommand(program);

    const config = program.commands.find((command) => command.name() === "config");
    const exportCommand = config?.commands.find((command) => command.name() === "export");

    expect(config).toBeDefined();
    expect(exportCommand).toBeDefined();
    expect(exportCommand?.options.map((option) => option.long)).toContain("--output-file");
    vi.restoreAllMocks();
  });
});
