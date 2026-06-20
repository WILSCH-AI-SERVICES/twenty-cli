import fs from "fs-extra";
import Papa from "papaparse";

export class ExportService {
  async export(
    records: Record<string, unknown>[],
    options: { format: "json" | "csv"; output?: string },
  ): Promise<void> {
    let content: string;

    if (options.format === "csv") {
      content = Papa.unparse(records as any[], { escapeFormulae: true });
    } else {
      content = JSON.stringify(records, null, 2);
    }

    if (options.output) {
      await fs.writeFile(options.output, content);
      // eslint-disable-next-line no-console
      console.error(`Exported ${records.length} records to ${options.output}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(content);
    }
  }
}
