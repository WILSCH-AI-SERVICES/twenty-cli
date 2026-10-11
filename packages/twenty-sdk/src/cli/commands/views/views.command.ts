import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";
import {
  translateSorts,
  translateView,
  type SortFieldInput,
  type ViewFilterGroupInput,
  type ViewFilterInput,
  type ViewSortInput,
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
 * filters, filter groups and sorts from the metadata store, translate them into the REST
 * filter and order, and list every record it selects, in the order the browser shows them
 * (#3236 AC3; every sort, not only the first, #3303).
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
    const sortRows = ((await services.metadata.listViewSorts()) as Resource[])
      .filter(ofView)
      // A sort carries no position when made through the API; then the order it was made in holds.
      .sort(
        (a, b) =>
          Number(a.position ?? 0) - Number(b.position ?? 0) ||
          String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
      );
    const sorts: ViewSortInput[] = [];
    for (const s of sortRows) {
      const field = fieldById.get(s.fieldMetadataId as string);
      if (!field) continue; // the browser drops a sort on a field it cannot find, and so does this
      const input: ViewSortInput = {
        field: { name: field.name as string, type: field.type as string },
        direction: s.direction as string,
        subFieldName: (s.subFieldName as string | null | undefined) ?? null,
      };
      if (field.type === "RELATION") input.relationLabel = await relationLabel(field.id);
      sorts.push(input);
    }
    // A relation sorts by the label identifier of the record it points at, as the browser does.
    async function relationLabel(fieldId: string): Promise<SortFieldInput | null> {
      const targetId = await services.metadata.getRelationTargetObjectId(fieldId);
      if (!targetId) return null;
      const target = (await services.metadata.getObject(targetId)) as unknown as {
        labelIdentifierFieldMetadataId?: string;
        fields?: Resource[];
      };
      const label = (target.fields ?? []).find(
        (f) => f.id === target.labelIdentifierFieldMetadataId,
      );
      return label ? { name: label.name as string, type: label.type as string } : null;
    }

    const filter = translateView(filters, groups, { now: new Date(), timeZone: options.timeZone });
    const orderBy = translateSorts(
      sorts,
      (full.fields ?? []).some((f) => f.name === "position"),
    );
    if (options.explain) {
      process.stderr.write(
        `view "${name}" on ${full.namePlural}\nfilter: ${filter || "(none)"}\norder_by: ${orderBy || "(none)"}\n`,
      );
    }

    const { data } = await services.records.listAll(full.namePlural, {
      ...(filter ? { filter } : {}),
      ...(orderBy ? { params: { order_by: [orderBy] } } : {}),
    });
    await services.output.render(data, {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });
}
