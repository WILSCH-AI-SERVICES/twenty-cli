import {
  type FieldMetadata,
  type MetadataService,
  type ObjectMetadata,
} from "../../metadata/services/metadata.service";
import { UnsupportedDbReadError } from "../../readbackend/types";

type MetadataClient = Pick<MetadataService, "listObjects" | "getObject">;

export interface DbRelationPlan {
  relationName: string;
  joinColumnName: string;
  fieldMetadata: FieldMetadata;
  objectMetadata: ObjectMetadata;
  tableName: string;
}

export interface DbObjectPlan {
  objectMetadata: ObjectMetadata;
  tableName: string;
  includes: DbRelationPlan[];
}

export class DbMetadataPlannerService {
  constructor(private readonly metadataService: MetadataClient) {}

  async planObject(objectName: string, options?: { include?: string }): Promise<DbObjectPlan> {
    const objects = await this.metadataService.listObjects();
    const baseObjectMetadata = findObjectMetadata(objects, objectName);
    const includeRelations = parseIncludeList(options?.include);
    const objectMetadata = await this.loadObjectMetadataForIncludes(
      baseObjectMetadata,
      includeRelations,
    );

    return {
      objectMetadata,
      tableName: toTableName(objectMetadata),
      includes: includeRelations.map((relationName) =>
        planRelationInclude(objects, objectMetadata, relationName),
      ),
    };
  }

  private async loadObjectMetadataForIncludes(
    objectMetadata: ObjectMetadata,
    includeRelations: string[],
  ): Promise<ObjectMetadata> {
    if (includeRelations.length === 0) {
      return objectMetadata;
    }

    return this.metadataService.getObject(objectMetadata.id);
  }
}

function findObjectMetadata(objects: ObjectMetadata[], objectName: string): ObjectMetadata {
  const match = objects.find(
    (objectMetadata) =>
      objectMetadata.nameSingular === objectName || objectMetadata.namePlural === objectName,
  );

  if (!match) {
    throw new UnsupportedDbReadError(
      `DB reads do not support unknown object ${JSON.stringify(objectName)}.`,
    );
  }

  return match;
}

function planRelationInclude(
  objects: ObjectMetadata[],
  objectMetadata: ObjectMetadata,
  relationName: string,
): DbRelationPlan {
  const fieldMetadata = (objectMetadata.fields ?? []).find(
    (field) => getFieldName(field) === relationName,
  );

  if (!fieldMetadata) {
    throw new UnsupportedDbReadError(
      `DB reads do not support include relation ${JSON.stringify(relationName)} for ${JSON.stringify(objectMetadata.namePlural ?? objectMetadata.nameSingular ?? objectMetadata.id)}.`,
    );
  }

  const targetObjectMetadataId = getTargetObjectMetadataId(fieldMetadata);
  const joinColumnName = getSupportedJoinColumnName(fieldMetadata, relationName);

  if (!targetObjectMetadataId) {
    throw new UnsupportedDbReadError(
      `DB reads do not support non-relation include ${JSON.stringify(relationName)}.`,
    );
  }

  const relatedObjectMetadata = objects.find(
    (candidate) => candidate.id === targetObjectMetadataId,
  );

  if (!relatedObjectMetadata) {
    throw new UnsupportedDbReadError(
      `DB reads do not support include relation ${JSON.stringify(relationName)} with missing target metadata.`,
    );
  }

  return {
    relationName,
    joinColumnName,
    fieldMetadata,
    objectMetadata: relatedObjectMetadata,
    tableName: toTableName(relatedObjectMetadata),
  };
}

function parseIncludeList(include?: string): string[] {
  if (!include) {
    return [];
  }

  return include
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getFieldName(fieldMetadata: FieldMetadata): string | undefined {
  const name = (fieldMetadata as Record<string, unknown>).name;

  return typeof name === "string" ? name : undefined;
}

function getTargetObjectMetadataId(fieldMetadata: FieldMetadata): string | undefined {
  const record = fieldMetadata as Record<string, unknown>;
  const relationTargetObjectMetadataId = record.relationTargetObjectMetadataId;

  if (typeof relationTargetObjectMetadataId === "string") {
    return relationTargetObjectMetadataId;
  }

  const targetObjectMetadataId = record.targetObjectMetadataId;

  return typeof targetObjectMetadataId === "string" ? targetObjectMetadataId : undefined;
}

function getSupportedJoinColumnName(fieldMetadata: FieldMetadata, relationName: string): string {
  const settings = getRelationSettings(fieldMetadata);

  if (settings.relationType !== "MANY_TO_ONE") {
    throw new UnsupportedDbReadError(
      `DB reads do not support include relation ${JSON.stringify(relationName)} without a source-side MANY_TO_ONE join column.`,
    );
  }

  if (typeof settings.joinColumnName !== "string" || settings.joinColumnName.trim().length === 0) {
    throw new UnsupportedDbReadError(
      `DB reads do not support include relation ${JSON.stringify(relationName)} without a source-side join column name.`,
    );
  }

  return settings.joinColumnName;
}

function getRelationSettings(fieldMetadata: FieldMetadata): Record<string, unknown> {
  const settings = (fieldMetadata as Record<string, unknown>).settings;

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  return settings as Record<string, unknown>;
}

function toTableName(objectMetadata: ObjectMetadata): string {
  const source = objectMetadata.nameSingular?.trim();

  if (!source) {
    throw new UnsupportedDbReadError(
      `DB reads do not support object metadata without a name for ${JSON.stringify(objectMetadata.id)}.`,
    );
  }

  return source;
}
