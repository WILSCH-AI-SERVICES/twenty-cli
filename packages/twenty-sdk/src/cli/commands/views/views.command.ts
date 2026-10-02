import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import {
  translateView,
  type ViewFilterGroupInput,
  type ViewFilterInput,
} from "./view-filter-translator";

interface ViewsRunOptions {
  object?: string;
  timeZone: string;
  explain?: boolean;
}

interface Resource {
  id: string;
  [key: string]: unknown;
}

/**
 * `twenty views run <name>` — re-apply a saved view from a terminal: read the view's
 * filters, filter groups and sort from the metadata store, translate them into the REST
 * filter, and list every record it selects (#3236 AC3).
 */
export function registerViewsCommand(program: Command): void {
  const views = program.command("views").description("Saved views, re-applied from a terminal");
  applyGlobalOptions(views);

  const run = views
    .command("run")
    .description("List the records a saved view selects, by the view's name")
    .argument("<name>", "The view's name")
    .option("--object <name>", "Object the view belongs to (when two views share a name)")
    .option("--time-zone <tz>", "Calendar for today / past / future", "Europe/Berlin")
    .option("--explain", "Print the translated filter to stderr");
  applyGlobalOptions(run);

  run.action(async (name: string, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const options = command.opts() as ViewsRunOptions;

    const objects = (await services.metadata.listObjects()) as unknown as Resource[];
    const objectById = new Map(objects.map((o) => [o.id, o]));
    let candidates = ((await services.metadata.listViews()) as Resource[]).filter(
      (v) => v.name === name,
    );
    if (options.object) {
      candidates = candidates.filter(
        (v) =>
          (objectById.get(v.objectMetadataId as string)?.nameSingular as string) === options.object,
      );
    }
    if (candidates.length !== 1) {
      throw new CliError(
        candidates.length === 0
          ? `No saved view named "${name}"${options.object ? ` on ${options.object}` : ""}`
          : `${candidates.length} views are named "${name}"; pass --object`,
        "INVALID_ARGUMENTS",
      );
    }
    const view = candidates[0] as Resource;
    const object = objectById.get(view.objectMetadataId as string);
    if (!object)
      throw new CliError(`View "${name}" belongs to no known object`, "INVALID_ARGUMENTS");
    const full = (await services.metadata.getObject(object.id)) as unknown as {
      namePlural: string;
      fields?: Resource[];
    };
    const fieldById = new Map((full.fields ?? []).map((f) => [f.id, f]));

    const ofView = (r: Resource) => r.viewId === view.id;
    const filters: ViewFilterInput[] = ((await services.metadata.listViewFilters()) as Resource[])
      .filter(ofView)
      .map((f) => {
        const field = fieldById.get(f.fieldMetadataId as string);
        if (!field)
          throw new CliError(`View "${name}" filters on an unknown field`, "INVALID_ARGUMENTS");
        if (f.subFieldName)
          throw new CliError(
            `View "${name}" filters on a sub-field (${String(f.subFieldName)}), not re-applied here`,
            "INVALID_ARGUMENTS",
          );
        return {
          fieldName: field.name as string,
          fieldType: field.type as string,
          operand: f.operand as string,
          value: (f.value as string) ?? "",
          viewFilterGroupId: (f.viewFilterGroupId as string | null) ?? null,
          positionInViewFilterGroup: (f.positionInViewFilterGroup as number | null) ?? null,
        };
      });
    const groups = ((await services.metadata.listViewFilterGroups()) as Resource[]).filter(
      ofView,
    ) as unknown as ViewFilterGroupInput[];
    const sorts = ((await services.metadata.listViewSorts()) as Resource[]).filter(ofView);

    const filter = translateView(filters, groups, { now: new Date(), timeZone: options.timeZone });
    const sort = sorts[0]
      ? (fieldById.get(sorts[0].fieldMetadataId as string)?.name as string)
      : undefined;
    const order = sorts[0] ? String(sorts[0].direction).toLowerCase() : undefined;
    if (options.explain) {
      process.stderr.write(
        `view "${name}" on ${full.namePlural}\nfilter: ${filter || "(none)"}\nsort: ${sort ?? "(none)"} ${order ?? ""}\n`,
      );
    }

    const { data } = await services.records.listAll(full.namePlural, {
      ...(filter ? { filter } : {}),
      ...(sort ? { sort, order } : {}),
    });
    await services.output.render(data, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}
