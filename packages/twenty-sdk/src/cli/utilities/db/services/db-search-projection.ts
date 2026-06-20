import type { ObjectMetadata } from "../../metadata/services/metadata.service";

export interface SearchProjection {
  labelColumns: string[];
  labelType: string; // "FULL_NAME" | "TEXT" | "EMAILS" | etc.
  imageColumn: string | null;
}

const HARDCODED_IMAGE_BY_OBJECT: Record<string, string> = {
  company: "domainNamePrimaryLinkUrl",
  person: "avatarFile",
  workspaceMember: "avatarUrl",
};

export function resolveSearchProjection(obj: ObjectMetadata): SearchProjection {
  const labelFieldId = obj.labelIdentifierFieldMetadataId as string | null | undefined;
  if (!labelFieldId) {
    throw new Error(`Object "${obj.nameSingular ?? obj.id}" has no label identifier field`);
  }
  const fields = (obj.fields ?? []) as Array<{
    id: string;
    name?: string;
    type?: string;
  }>;
  const labelField = fields.find((f) => f.id === labelFieldId);
  if (!labelField || !labelField.name) {
    throw new Error(
      `Object "${obj.nameSingular ?? obj.id}" label field ${labelFieldId} not found in fields`,
    );
  }

  const labelColumns =
    labelField.type === "FULL_NAME"
      ? [`${labelField.name}FirstName`, `${labelField.name}LastName`]
      : [labelField.name];

  const imageFieldId = obj.imageIdentifierFieldMetadataId as string | null | undefined;
  let imageColumn: string | null = null;
  if (imageFieldId) {
    const imageField = fields.find((f) => f.id === imageFieldId);
    imageColumn = imageField?.name ?? null;
  }
  if (!imageColumn && obj.nameSingular) {
    imageColumn = HARDCODED_IMAGE_BY_OBJECT[obj.nameSingular as string] ?? null;
  }

  return {
    labelColumns,
    labelType: labelField.type ?? "TEXT",
    imageColumn,
  };
}

export function joinLabelParts(values: Array<string | null | undefined>): string {
  return values
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .trim();
}
