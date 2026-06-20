import { Command } from "commander";

import { requireGraphqlField, type GraphQLResponse } from "../../utilities/api/graphql-response";
import { CliError } from "../../utilities/errors/cli-error";
import { parseBody } from "../../utilities/shared/body";
import { createCommandContext } from "../../utilities/shared/context";
import { applyGlobalOptions } from "../../utilities/shared/global-options";

interface SkillsOptions {
  data?: string;
  file?: string;
  set?: string[];
}

const endpoint = "/metadata";

const SKILL_FIELDS = `
  id
  name
  label
  icon
  description
  content
  isCustom
  isActive
  applicationId
  createdAt
  updatedAt
`;

const LIST_SKILLS_QUERY = `query ListSkills {
  skills {
    ${SKILL_FIELDS}
  }
}`;

const GET_SKILL_QUERY = `query GetSkill($id: UUID!) {
  skill(id: $id) {
    ${SKILL_FIELDS}
  }
}`;

const CREATE_SKILL_MUTATION = `mutation CreateSkill($input: CreateSkillInput!) {
  createSkill(input: $input) {
    ${SKILL_FIELDS}
  }
}`;

const UPDATE_SKILL_MUTATION = `mutation UpdateSkill($input: UpdateSkillInput!) {
  updateSkill(input: $input) {
    ${SKILL_FIELDS}
  }
}`;

const DELETE_SKILL_MUTATION = `mutation DeleteSkill($id: UUID!) {
  deleteSkill(id: $id) {
    ${SKILL_FIELDS}
  }
}`;

const ACTIVATE_SKILL_MUTATION = `mutation ActivateSkill($id: UUID!) {
  activateSkill(id: $id) {
    ${SKILL_FIELDS}
  }
}`;

const DEACTIVATE_SKILL_MUTATION = `mutation DeactivateSkill($id: UUID!) {
  deactivateSkill(id: $id) {
    ${SKILL_FIELDS}
  }
}`;

function collect(value: string, previous: string[] = []): string[] {
  return previous.concat([value]);
}

function requireSkillId(id: string | undefined): string {
  if (!id) {
    throw new CliError("Missing skill ID.", "INVALID_ARGUMENTS");
  }

  return id;
}

export function registerSkillsCommand(program: Command): void {
  const cmd = program.command("skills").description("Manage workspace AI skills");
  applyGlobalOptions(cmd);

  const listCmd = cmd.command("list").description("List skills");
  applyGlobalOptions(listCmd);
  listCmd.action(async (_options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const response = await services.api.post<GraphQLResponse<{ skills?: unknown[] }>>(endpoint, {
      query: LIST_SKILLS_QUERY,
    });

    const skills = requireGraphqlField(response.data ?? {}, "skills", "Failed to list skills.");
    await services.output.render(skills ?? [], {
      format: globalOptions.output,
      query: globalOptions.query,
    });
  });

  const getCmd = cmd.command("get").description("Get a skill").argument("[id]", "Skill ID");
  applyGlobalOptions(getCmd);
  getCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const skillId = requireSkillId(id);
    const response = await services.api.post<GraphQLResponse<{ skill?: unknown }>>(endpoint, {
      query: GET_SKILL_QUERY,
      variables: { id: skillId },
    });

    await services.output.render(
      requireGraphqlField(response.data ?? {}, "skill", `Failed to fetch skill ${skillId}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const createCmd = cmd.command("create").description("Create a skill");
  createCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(createCmd);
  createCmd.action(async (options: SkillsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const payload = await parseBody(options.data, options.file, options.set);
    const response = await services.api.post<GraphQLResponse<{ createSkill?: unknown }>>(endpoint, {
      query: CREATE_SKILL_MUTATION,
      variables: { input: payload },
    });

    await services.output.render(
      requireGraphqlField(response.data ?? {}, "createSkill", "Failed to create skill."),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const updateCmd = cmd
    .command("update")
    .description("Update a skill")
    .argument("[id]", "Skill ID");
  updateCmd
    .option("-d, --data <json>", "JSON payload")
    .option("-f, --file <path>", "JSON file")
    .option("--set <key=value>", "Set a field value", collect);
  applyGlobalOptions(updateCmd);
  updateCmd.action(async (id: string | undefined, options: SkillsOptions, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const skillId = requireSkillId(id);
    const payload = await parseBody(options.data, options.file, options.set);
    const response = await services.api.post<GraphQLResponse<{ updateSkill?: unknown }>>(endpoint, {
      query: UPDATE_SKILL_MUTATION,
      variables: {
        input: {
          id: skillId,
          ...payload,
        },
      },
    });

    await services.output.render(
      requireGraphqlField(response.data ?? {}, "updateSkill", `Failed to update skill ${skillId}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deleteCmd = cmd
    .command("delete")
    .description("Delete a skill")
    .argument("[id]", "Skill ID");
  applyGlobalOptions(deleteCmd);
  deleteCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const skillId = requireSkillId(id);
    const response = await services.api.post<GraphQLResponse<{ deleteSkill?: unknown }>>(endpoint, {
      query: DELETE_SKILL_MUTATION,
      variables: { id: skillId },
    });

    await services.output.render(
      requireGraphqlField(response.data ?? {}, "deleteSkill", `Failed to delete skill ${skillId}.`),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const activateCmd = cmd
    .command("activate")
    .description("Activate a skill")
    .argument("[id]", "Skill ID");
  applyGlobalOptions(activateCmd);
  activateCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const skillId = requireSkillId(id);
    const response = await services.api.post<GraphQLResponse<{ activateSkill?: unknown }>>(
      endpoint,
      {
        query: ACTIVATE_SKILL_MUTATION,
        variables: { id: skillId },
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "activateSkill",
        `Failed to activate skill ${skillId}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });

  const deactivateCmd = cmd
    .command("deactivate")
    .description("Deactivate a skill")
    .argument("[id]", "Skill ID");
  applyGlobalOptions(deactivateCmd);
  deactivateCmd.action(async (id: string | undefined, _options: unknown, command: Command) => {
    const { globalOptions, services } = await createCommandContext(command);
    const skillId = requireSkillId(id);
    const response = await services.api.post<GraphQLResponse<{ deactivateSkill?: unknown }>>(
      endpoint,
      {
        query: DEACTIVATE_SKILL_MUTATION,
        variables: { id: skillId },
      },
    );

    await services.output.render(
      requireGraphqlField(
        response.data ?? {},
        "deactivateSkill",
        `Failed to deactivate skill ${skillId}.`,
      ),
      {
        format: globalOptions.output,
        query: globalOptions.query,
      },
    );
  });
}
