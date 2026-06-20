import { describe, expect, it } from "vitest";

import type { ReadSource } from "../../../../shared/global-options";
import { createServices } from "../../../../shared/services";
import { buildDbCoverage } from "../../db-coverage";
import {
  assertRecordsEqualRedacted,
  asRecord,
  byId,
  liveEnabled,
  normalizeRecord,
  parityObject,
} from "./helpers";

describe.skipIf(!liveEnabled())("live DB-vs-API parity (prod, read-only)", () => {
  it("db doctor reports a healthy resolved DB target", async () => {
    const services = await createServices({
      readSource: "auto",
      output: "json",
    });

    const status = await services.dbStatus.doctor({ readSource: "auto" });

    expect(status.ok).toBe(true);
    expect(status.configured).toBe(true);
    expect(status.connection?.ok).toBe(true);
    expect(status.resolvedSchema).toMatch(/^workspace_/);
  });

  it("db coverage marks the direct read commands as DB-backed", () => {
    const report = buildDbCoverage(["api list", "api get", "search", "db doctor", "db coverage"]);
    const byCommand = Object.fromEntries(report.items.map((item) => [item.command, item]));

    expect(byCommand["api list"]).toMatchObject({ currentBackend: "db" });
    expect(byCommand["api get"]).toMatchObject({ currentBackend: "db" });
    expect(byCommand.search).toMatchObject({ currentBackend: "db" });
  });

  it("records list matches between db and api for a small page", async () => {
    const object = parityObject();
    const limit = 5;

    const dbResult = await listViaReadSource(object, "db", limit);
    const apiResult = await listViaReadSource(object, "api", limit);

    const dbNorm = dbResult.map(normalizeRecord).sort(byId);
    const apiNorm = apiResult.map(normalizeRecord).sort(byId);

    expect(dbNorm.length).toBe(apiNorm.length);
    assertRecordsEqualRedacted(dbNorm, apiNorm);
  });

  it("get-by-id matches between db and api", async () => {
    const object = parityObject();
    const [first] = await listViaReadSource(object, "api", 1);
    const id = typeof first?.id === "string" ? first.id : "";
    if (!id) return;

    const dbOne = normalizeRecord(asRecord(await getViaReadSource(object, id, "db")));
    const apiOne = normalizeRecord(asRecord(await getViaReadSource(object, id, "api")));

    assertRecordsEqualRedacted([dbOne], [apiOne]);
  });
});

async function listViaReadSource(
  object: string,
  readSource: ReadSource,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const services = await createServices({
    readSource,
    output: "json",
  });
  const result = await services.records.list(object, { limit });
  return result.data.map(asRecord);
}

async function getViaReadSource(
  object: string,
  id: string,
  readSource: ReadSource,
): Promise<unknown> {
  const services = await createServices({
    readSource,
    output: "json",
  });
  return services.records.get(object, id);
}
