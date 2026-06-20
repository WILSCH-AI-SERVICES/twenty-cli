import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SourceTracker } from "../../../readbackend/types";
import { assertCompactAliasesAreValid, toLightPayload } from "../compact-aliases";
import { OutputService } from "../output.service";
import { QueryService } from "../query.service";
import { TableService } from "../table.service";

describe("OutputService", () => {
  let outputService: OutputService;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const queryService = new QueryService();
    const tableService = new TableService();
    outputService = new OutputService(tableService, queryService);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("CSV output with nested objects", () => {
    it("serializes nested objects to JSON strings", async () => {
      const data = [
        {
          id: "1",
          name: { firstName: "John", lastName: "Doe" },
          emails: { primaryEmail: "john@example.com", additionalEmails: [] },
        },
      ];

      await outputService.render(data, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("id,name,emails");
      // CSV escapes inner quotes by doubling them: "" inside quoted field
      expect(output).toContain('"{""firstName"":""John"",""lastName"":""Doe""}"');
      expect(output).not.toContain("[object Object]");
    });

    it("handles arrays in CSV output", async () => {
      const data = [{ id: "1", tags: ["a", "b", "c"] }];

      await outputService.render(data, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      // CSV escapes inner quotes by doubling them: "" inside quoted field
      expect(output).toContain('"[""a"",""b"",""c""]"');
      expect(output).not.toContain("[object Object]");
    });

    it("handles null and primitive values correctly", async () => {
      const data = [{ id: "1", name: "Test", count: 42, active: true, deleted: null }];

      await outputService.render(data, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("Test");
      expect(output).toContain("42");
      expect(output).toContain("true");
    });

    it("escapes formula-like strings in CSV cells", async () => {
      const data = [{ id: "1", name: '=HYPERLINK("https://example.com")' }];

      await outputService.render(data, { format: "csv" });

      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("\"'=HYPERLINK");
      expect(output).not.toContain("\n1,=HYPERLINK");
    });
  });

  describe("text output with CLI diagnostics", () => {
    it("prints a CLI note and omits _cli from the rendered table", async () => {
      await outputService.render(
        {
          message:
            "No skills found with names: xlsx. Available skills: workflow-building, data-manipulation, xlsx, pdf.",
          skills: [],
          _cli: {
            diagnosis: "workspace_skills_unavailable",
            message:
              "The MCP server advertised skill names but returned no loaded skills for this workspace. This is likely a workspace configuration issue, not a CLI transport failure.",
          },
        },
        { format: "text" },
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        "Note: The MCP server advertised skill names but returned no loaded skills for this workspace. This is likely a workspace configuration issue, not a CLI transport failure.",
      );
      expect(consoleSpy.mock.calls[1]?.[0]).toContain("MESSAGE");
      expect(consoleSpy.mock.calls[1]?.[0]).toContain("SKILLS");
      expect(consoleSpy.mock.calls[1]?.[0]).not.toContain("_CLI");
    });
  });

  describe("JSONL output", () => {
    it("writes arrays as newline-delimited JSON objects", async () => {
      await outputService.render(
        [
          { id: "1", name: "Ada" },
          { id: "2", name: "Linus" },
        ],
        { format: "jsonl" },
      );

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0]).toBe(
        '{"id":"1","name":"Ada"}\n{"id":"2","name":"Linus"}',
      );
    });

    it("writes singleton values as one JSON line", async () => {
      await outputService.render({ ok: true }, { format: "jsonl" });

      expect(consoleSpy).toHaveBeenCalledWith('{"ok":true}');
    });
  });

  describe("structured fallback metadata", () => {
    it("adds reserved _cli read metadata to JSON output after DB fallback", async () => {
      const tracker = new SourceTracker();
      tracker.recordFallback("schema drift (42703)");
      tracker.mark("api");
      outputService = new OutputService(new TableService(), new QueryService(), {
        agentMode: true,
        format: "json",
        light: true,
        sourceTracker: tracker,
      });

      await outputService.render([{ id: "1", displayName: "Ada" }], {});

      expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toEqual({
        data: [{ id: "1", dn: "Ada" }],
        _cli: {
          read: {
            source: "api",
            fallback: {
              from: "db",
              to: "api",
              reason: "schema drift (42703)",
            },
          },
        },
      });
    });

    it("does not add _cli metadata when no fallback happened", async () => {
      const tracker = new SourceTracker();
      tracker.mark("db");
      outputService = new OutputService(new TableService(), new QueryService(), {
        agentMode: true,
        format: "json",
        light: true,
        sourceTracker: tracker,
      });

      await outputService.render([{ id: "1", displayName: "Ada" }], {});

      expect(consoleSpy).toHaveBeenCalledWith('[{"id":"1","dn":"Ada"}]');
    });

    it("keeps non-agent JSON output unchanged after DB fallback", async () => {
      const tracker = new SourceTracker();
      tracker.recordFallback("schema drift (42703)");
      tracker.mark("api");
      outputService = new OutputService(new TableService(), new QueryService(), {
        agentMode: false,
        format: "json",
        light: true,
        sourceTracker: tracker,
      });

      await outputService.render([{ id: "1", displayName: "Ada" }], {});

      expect(consoleSpy).toHaveBeenCalledWith('[{"id":"1","dn":"Ada"}]');
    });

    it("adds fallback metadata to every JSONL record after DB fallback", async () => {
      const tracker = new SourceTracker();
      tracker.recordFallback("schema drift (42703)");
      tracker.mark("api");
      outputService = new OutputService(new TableService(), new QueryService(), {
        agentMode: true,
        format: "jsonl",
        sourceTracker: tracker,
      });

      await outputService.render([{ id: "1" }, { id: "2" }], {});

      expect(consoleSpy.mock.calls[0][0]).toBe(
        [
          '{"id":"1","_cli":{"read":{"source":"api","fallback":{"from":"db","to":"api","reason":"schema drift (42703)"}}}}',
          '{"id":"2","_cli":{"read":{"source":"api","fallback":{"from":"db","to":"api","reason":"schema drift (42703)"}}}}',
        ].join("\n"),
      );
    });
  });

  describe("compact light output", () => {
    it("keeps compact aliases unique", () => {
      expect(() => assertCompactAliasesAreValid()).not.toThrow();
    });

    it("projects known canonical fields to short keys recursively", () => {
      expect(
        toLightPayload({
          id: "person-1",
          displayName: "Ada Lovelace",
          primaryEmail: "ada@example.test",
          createdAt: "2026-04-26T00:00:00.000Z",
          company: {
            id: "company-1",
            displayName: "Analytical Engines",
          },
        }),
      ).toEqual({
        id: "person-1",
        dn: "Ada Lovelace",
        pem: "ada@example.test",
        ca: "2026-04-26T00:00:00.000Z",
        co: {
          id: "company-1",
          dn: "Analytical Engines",
        },
      });
    });

    it("projects command and diagnostic fields to short keys", () => {
      expect(
        toLightPayload({
          command: "db coverage",
          family: "db",
          status: "db_read",
          currentBackend: "db",
          targetBackend: "db",
          blocker: "none",
          source: "profile",
          fallbackReason: "missing capability",
          configured: true,
          connection: {
            ok: true,
          },
          resources: [
            {
              name: "people",
              readable: true,
            },
          ],
          warnings: ["check optional indexes"],
        }),
      ).toEqual({
        cmd: "db coverage",
        fam: "db",
        st: "db_read",
        cb: "db",
        tb: "db",
        blk: "none",
        src: "profile",
        fr: "missing capability",
        cfg: true,
        cn: {
          ok: true,
        },
        res: [
          {
            nm: "people",
            rd: true,
          },
        ],
        wrn: ["check optional indexes"],
      });
    });

    it("writes compact JSON without pretty-print whitespace", async () => {
      await outputService.render({ id: "1", name: "Ada" }, { format: "json" });

      expect(consoleSpy).toHaveBeenCalledWith('{"id":"1","name":"Ada"}');
    });

    it("applies queries before light projection", async () => {
      await outputService.render(
        {
          records: [
            { id: "1", displayName: "Ada", primaryEmail: "ada@example.test" },
            { id: "2", displayName: "Linus", primaryEmail: "linus@example.test" },
          ],
        },
        {
          format: "json",
          light: true,
          query: "records",
        },
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        '[{"id":"1","dn":"Ada","pem":"ada@example.test"},{"id":"2","dn":"Linus","pem":"linus@example.test"}]',
      );
    });

    it("uses default light mode unless full is explicit", async () => {
      outputService = new OutputService(new TableService(), new QueryService(), {
        format: "json",
        light: true,
      });

      await outputService.render({ displayName: "Ada" }, {});
      await outputService.render({ displayName: "Ada" }, { full: true });

      expect(consoleSpy.mock.calls[0][0]).toBe('{"dn":"Ada"}');
      expect(consoleSpy.mock.calls[1][0]).toBe('{"displayName":"Ada"}');
    });
  });
});
