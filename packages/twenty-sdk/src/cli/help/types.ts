import { Command } from "commander";

export interface HelpOperationMetadata {
  name: string;
  summary?: string;
  mutates?: boolean;
}

export interface HelpMetadata {
  examples?: string[];
  operations?: HelpOperationMetadata[];
  mutates?: boolean;
}

export interface HelpArgument {
  name: string;
  required: boolean;
  variadic: boolean;
  description?: string;
}

export interface HelpOption {
  name: string;
  aliases: string[];
  flags: string;
  type: string;
  default?: string;
  required: boolean;
  global: boolean;
  description: string;
}

export interface HelpOperation {
  name: string;
  summary: string;
  mutates: boolean;
}

export interface HelpExitCode {
  code: number;
  summary: string;
}

export interface HelpOutputContract {
  query_language: "JMESPath";
  query_applies_before_format: boolean;
  formats: Array<{
    name: "csv" | "json" | "jsonl" | "text";
    summary: string;
  }>;
}

export interface HelpSubcommand {
  name: string;
  aliases: string[];
  summary: string;
}

export interface HelpCapabilities {
  mutates: boolean;
  supports_query: boolean;
  supports_workspace: boolean;
  supports_output: boolean;
}

export interface HelpDocument {
  schema_version: 1;
  kind: "root" | "command";
  name: string;
  aliases: string[];
  path: string[];
  summary: string;
  description?: string;
  usage: string;
  examples: string[];
  args: HelpArgument[];
  options: HelpOption[];
  operations: HelpOperation[];
  subcommands: HelpSubcommand[];
  capabilities: HelpCapabilities;
  exit_codes: HelpExitCode[];
  output_contract?: HelpOutputContract;
}

export type HelpWriter = (text: string) => void;
export type HelpCommand = Command;
