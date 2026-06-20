import path from "path";

import fs from "fs-extra";
import Papa from "papaparse";

export class ImportService {
  async import(
    filePath: string,
    options?: { dryRun?: boolean },
  ): Promise<Record<string, unknown>[]> {
    const content = await fs.readFile(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();

    let records: Record<string, unknown>[] = [];

    if (ext === ".csv") {
      const result = Papa.parse(content, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim(),
      });
      records = result.data as Record<string, unknown>[];
    } else if (ext === ".json") {
      const parsed = JSON.parse(content) as unknown;
      records = Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : [parsed as Record<string, unknown>];
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }

    if (options?.dryRun) {
      // eslint-disable-next-line no-console
      console.log(`Would import ${records.length} records`);
      if (records[0]) {
        // eslint-disable-next-line no-console
        console.log("First record:", JSON.stringify(records[0], null, 2));
      }
    }

    return records;
  }
}
