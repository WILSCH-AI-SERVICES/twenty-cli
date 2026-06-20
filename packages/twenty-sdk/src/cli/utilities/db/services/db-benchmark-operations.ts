export type BenchmarkSource = "api" | "db";

export interface BenchmarkFixture {
  object: string;
  objectCommand?: string;
  recordId?: string;
  groupByField?: string;
  query?: string;
}

export interface BenchmarkOperation {
  key: string;
  label: string;
  requires: Array<keyof BenchmarkFixture>;
  buildArgs(source: BenchmarkSource, fixture: BenchmarkFixture): string[];
}

export const DEFAULT_BENCHMARK_QUERY = "acme";
export const DEFAULT_BENCHMARK_LIMIT = "25";

export const BENCHMARK_OPERATIONS: BenchmarkOperation[] = [
  {
    key: "search",
    label: "search query",
    requires: ["query"],
    buildArgs: (source, fixture) => [
      "search",
      fixture.query ?? DEFAULT_BENCHMARK_QUERY,
      "--limit",
      "10",
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "api-list",
    label: "api list",
    requires: ["object"],
    buildArgs: (source, fixture) => [
      "api",
      "list",
      fixture.object,
      "--limit",
      DEFAULT_BENCHMARK_LIMIT,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "api-list-all",
    label: "api list all",
    requires: ["object", "recordId"],
    buildArgs: (source, fixture) => [
      "api",
      "list",
      fixture.object,
      "--all",
      "--limit",
      DEFAULT_BENCHMARK_LIMIT,
      "--filter",
      `id[eq]:${fixture.recordId!}`,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "api-get",
    label: "api get",
    requires: ["object", "recordId"],
    buildArgs: (source, fixture) => [
      "api",
      "get",
      fixture.object,
      fixture.recordId!,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "api-export-json",
    label: "api export json",
    requires: ["object"],
    buildArgs: (source, fixture) => [
      "api",
      "export",
      fixture.object,
      "--format",
      "json",
      "--limit",
      DEFAULT_BENCHMARK_LIMIT,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "api-group-by",
    label: "api group by",
    requires: ["object", "groupByField"],
    buildArgs: (source, fixture) => [
      "api",
      "group-by",
      fixture.object,
      "--field",
      fixture.groupByField!,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "records-list",
    label: "records list",
    requires: ["objectCommand"],
    buildArgs: (source, fixture) => [
      "records",
      fixture.objectCommand!,
      "list",
      "--limit",
      DEFAULT_BENCHMARK_LIMIT,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "records-get",
    label: "records get",
    requires: ["objectCommand", "recordId"],
    buildArgs: (source, fixture) => [
      "records",
      fixture.objectCommand!,
      "get",
      fixture.recordId!,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
  {
    key: "records-group-by",
    label: "records group by",
    requires: ["objectCommand", "groupByField"],
    buildArgs: (source, fixture) => [
      "records",
      fixture.objectCommand!,
      "group-by",
      "--field",
      fixture.groupByField!,
      "--rs",
      source,
      "--output",
      "json",
      "--full",
    ],
  },
];
