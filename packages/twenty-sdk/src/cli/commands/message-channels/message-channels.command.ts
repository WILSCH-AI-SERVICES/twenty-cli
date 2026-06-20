import { Command } from "commander";

import { registerRecordResourceCommand } from "../../utilities/records/commands/register-record-resource-command";

export function registerMessageChannelsCommand(program: Command): void {
  registerRecordResourceCommand(program, {
    name: "message-channels",
    description: "Inspect and update message channel settings",
    object: "messageChannels",
    sanitizeOutput: sanitizeChannelOutput,
  });
}

function sanitizeChannelOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeChannelOutput);
  }

  if (value == null || typeof value !== "object") {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };

  if ("syncCursor" in record && record.syncCursor != null && record.syncCursor !== "") {
    record.syncCursor = "[hidden]";
  }

  return record;
}
