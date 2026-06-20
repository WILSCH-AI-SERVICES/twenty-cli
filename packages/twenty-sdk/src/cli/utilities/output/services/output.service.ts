import Papa from "papaparse";

import type { ReadOutputMetadata, SourceTracker } from "../../readbackend/types";
import type { OutputFormat } from "../../shared/global-options";
import { toLightPayload } from "./compact-aliases";
import { QueryService } from "./query.service";
import { TableService } from "./table.service";

export interface OutputOptions {
  format?: OutputFormat;
  query?: string;
  light?: boolean;
  full?: boolean;
  agentMode?: boolean;
  sourceTracker?: SourceTracker;
}

interface OutputServiceDefaults extends OutputOptions {}

export class OutputService {
  constructor(
    private table: TableService,
    private queryService: QueryService,
    private defaults: OutputServiceDefaults = {},
  ) {}

  async render(data: unknown, options: OutputOptions = {}): Promise<void> {
    const query = options.query ?? this.defaults.query;
    const full = options.full ?? this.defaults.full ?? false;
    const light = !full && (options.light ?? this.defaults.light ?? false);
    let result: unknown = data;
    if (query) {
      result = this.queryService.apply(result, query);
    }
    if (light) {
      result = toLightPayload(result);
    }

    const format = options.format ?? this.defaults.format ?? "json";
    switch (format) {
      case "json":
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(this.withStructuredCliMetadata(result)));
        break;
      case "jsonl":
        // eslint-disable-next-line no-console
        console.log(this.formatJsonLines(result, this.readFallbackMetadata()));
        break;
      case "csv":
        // eslint-disable-next-line no-console
        console.log(this.formatCsv(result));
        break;
      case "text":
        {
          const { data: textData, cliMessage } = this.extractTextCliDiagnostic(result);
          if (cliMessage) {
            // eslint-disable-next-line no-console
            console.log(`Note: ${cliMessage}`);
          }
          this.table.render(textData);
        }
        break;
      case "markdown":
        // eslint-disable-next-line no-console
        console.log(typeof result === "string" ? result : this.formatMarkdown(result));
        break;
      default:
        throw new Error(`Unsupported output format: ${format}`);
    }
  }

  private extractTextCliDiagnostic(data: unknown): { data: unknown; cliMessage?: string } {
    if (!isRecord(data)) {
      return { data };
    }

    const cli = data._cli;
    if (!isRecord(cli) || typeof cli.message !== "string" || cli.message.trim() === "") {
      return { data };
    }

    const { _cli, ...rest } = data;
    return {
      data: rest,
      cliMessage: cli.message,
    };
  }

  private withStructuredCliMetadata(data: unknown): unknown {
    const metadata = this.readFallbackMetadata();
    if (!metadata) {
      return data;
    }

    return addCliMetadata(data, metadata);
  }

  private readFallbackMetadata(): ReadOutputMetadata | undefined {
    if (this.defaults.agentMode !== true) {
      return undefined;
    }

    const tracker = this.defaults.sourceTracker;
    const metadata = tracker?.outputMetadata();
    if (!metadata?.read.fallback) {
      return undefined;
    }

    return metadata;
  }

  private formatCsv(data: unknown): string {
    const records = Array.isArray(data) ? data : [data];
    const preprocessed = records.map((record) => this.preprocessForCsv(record));
    return Papa.unparse(preprocessed as Array<Record<string, unknown>>, { escapeFormulae: true });
  }

  private formatJsonLines(data: unknown, metadata?: ReadOutputMetadata): string {
    const records = Array.isArray(data) ? data : [data];
    return records.map((record) => JSON.stringify(addCliMetadata(record, metadata))).join("\n");
  }

  private preprocessForCsv(record: unknown): unknown {
    if (record === null || record === undefined) {
      return record;
    }
    if (typeof record !== "object") {
      return record;
    }
    if (Array.isArray(record)) {
      return JSON.stringify(record);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (value === null || value === undefined) {
        result[key] = "";
      } else if (typeof value === "object") {
        result[key] = JSON.stringify(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private formatMarkdown(data: unknown): string {
    const records = Array.isArray(data) ? data : [data];
    const rows = records.filter(isRecord);
    if (rows.length === 0) {
      return "";
    }

    const columns = Object.keys(rows[0] ?? {});
    return [
      `| ${columns.join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      ...rows.map(
        (row) => `| ${columns.map((column) => formatMarkdownCell(row[column])).join(" | ")} |`,
      ),
    ].join("\n");
  }
}

function addCliMetadata(data: unknown, metadata?: ReadOutputMetadata): unknown {
  if (!metadata) {
    return data;
  }

  if (!isRecord(data)) {
    return { data, _cli: metadata };
  }

  const existingCli = isRecord(data._cli) ? data._cli : {};
  return {
    ...data,
    _cli: {
      ...existingCli,
      ...metadata,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMarkdownCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
