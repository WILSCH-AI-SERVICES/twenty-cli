import { Command } from "commander";

import { CliError } from "../../utilities/errors/cli-error";
import { applyGlobalOptions, resolveGlobalOptions } from "../../utilities/shared/global-options";
import { readFileOrStdin, safeJsonParse } from "../../utilities/shared/io";
import { registerCommand } from "../../utilities/shared/register-command";
import { createServices } from "../../utilities/shared/services";

const WORKSPACE_SKILLS_UNAVAILABLE_MESSAGE =
  "The MCP server advertised skill names but returned no loaded skills for this workspace. This is likely a workspace configuration issue, not a CLI transport failure.";

export function registerMcpCommand(program: Command): void {
  const cmd = program.command("mcp").description("Interact with the official Twenty MCP server");

  registerCommand(cmd, "status", "Show MCP availability for the active workspace", (command) => {
    applyGlobalOptions(command);
    command.action(async (_options, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const result = await services.mcp.status();

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(cmd, "catalog", "Show the official MCP tool catalog", (command) => {
    applyGlobalOptions(command);
    command.action(async (_options, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const result = await services.mcp.callTool("get_tool_catalog", {});

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(cmd, "schema", "Show the schema for one or more MCP tools", (command) => {
    command.argument("<toolNames...>", "Tool names to inspect");
    applyGlobalOptions(command);
    command.action(async (toolNames: string[], _options, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const result = await services.mcp.callTool("learn_tools", { toolNames });

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(cmd, "exec", "Execute an official MCP tool by name", (command) => {
    command.argument("<tool>", "Official MCP tool name");
    command.option("--data <json>", "Tool arguments as inline JSON");
    command.option(
      "--file <path>",
      "Path to a JSON file containing tool arguments (use - for stdin)",
    );
    applyGlobalOptions(command);
    command.action(async (tool: string, options: ExecOptions, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const argumentsObject = await readMcpExecArguments(options);
      const result = await services.mcp.callTool("execute_tool", {
        toolName: tool,
        arguments: argumentsObject,
      });

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(cmd, "skills", "Load official MCP skills", (command) => {
    command.argument("<skillNames...>", "Skill names to load");
    applyGlobalOptions(command);
    command.action(async (skillNames: string[], _options, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const result = annotateMcpSkillsResult(
        await services.mcp.callTool("load_skills", { skillNames }),
      );

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });

  registerCommand(cmd, "search", "Search the official MCP help center", (command) => {
    command.argument("<query>", "Help center query");
    applyGlobalOptions(command);
    command.action(async (query: string, _options, actionCommand: Command) => {
      const globalOptions = resolveGlobalOptions(actionCommand);
      const services = await createServices(globalOptions);
      const result = await services.mcp.callTool("search_help_center", { query });

      await services.output.render(result, {
        format: globalOptions.output,
        query: globalOptions.query,
      });
    });
  });
}

interface ExecOptions {
  data?: string;
  file?: string;
}

async function readMcpExecArguments(options: ExecOptions): Promise<Record<string, unknown>> {
  const sources = [options.data, options.file].filter((value) => value != null);
  if (sources.length > 1) {
    throw new CliError(
      "provide mcp exec arguments via --data or --file, not multiple sources",
      "INVALID_ARGUMENTS",
    );
  }

  if (sources.length === 0) {
    return {};
  }

  if (options.file) {
    let content: string;
    try {
      content = await readFileOrStdin(options.file);
    } catch {
      throw new CliError(
        `Unable to read mcp exec arguments file: ${options.file}`,
        "INVALID_ARGUMENTS",
      );
    }

    if (content.trim() === "") {
      return {};
    }

    return parseMcpCallArguments(content);
  }

  return parseMcpCallArguments(options.data);
}

function parseMcpCallArguments(rawJson: string | undefined): Record<string, unknown> {
  if (rawJson == null || rawJson.trim() === "") {
    return {};
  }

  let payload: unknown;
  try {
    payload = safeJsonParse(rawJson);
  } catch {
    throw new CliError("mcp exec arguments must be valid JSON.", "INVALID_ARGUMENTS");
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CliError("mcp exec arguments must be a JSON object.", "INVALID_ARGUMENTS");
  }

  return payload as Record<string, unknown>;
}

function annotateMcpSkillsResult(result: unknown): unknown {
  if (!isAmbiguousSkillsResult(result)) {
    return result;
  }

  return {
    ...result,
    _cli: {
      diagnosis: "workspace_skills_unavailable",
      message: WORKSPACE_SKILLS_UNAVAILABLE_MESSAGE,
    },
  };
}

function isAmbiguousSkillsResult(
  result: unknown,
): result is { skills: unknown[]; message: string } & Record<string, unknown> {
  if (!isRecord(result)) {
    return false;
  }

  return (
    Array.isArray(result.skills) &&
    result.skills.length === 0 &&
    typeof result.message === "string" &&
    result.message.startsWith("No skills found") &&
    result.message.includes("Available skills:")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
