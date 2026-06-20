import { Command } from "commander";

import { GraphQLResponse } from "../../utilities/api/graphql-response";
import { GlobalOptions } from "../../utilities/shared/global-options";
import { CliServices } from "../../utilities/shared/services";

export interface ServerlessOptions {
  data?: string;
  file?: string;
  set?: string[];
  name?: string;
  description?: string;
  timeoutSeconds?: number;
  universalIdentifier?: string;
  applicationId?: string;
  applicationUniversalIdentifier?: string;
  maxEvents?: number;
  waitSeconds?: number;
  packageJson?: string;
  packageJsonFile?: string;
  yarnLock?: string;
  yarnLockFile?: string;
  yes?: boolean;
}

export interface OperationRequest {
  query: string;
  resultKey: string;
  variables?: Record<string, unknown>;
  schemaSymbols?: string[];
}

export interface CompatibleOperation {
  current: OperationRequest;
  legacy?: OperationRequest;
  unavailableOnLegacyMessage?: string;
}

export interface ServerlessOperationContext {
  globalOptions: GlobalOptions;
  services: CliServices;
  options: ServerlessOptions;
}

export interface ServerlessSubcommandConfig {
  name: string;
  description: string;
  alias?: string;
  hasIdArgument?: boolean;
  configure?: (command: Command) => void;
  action: (id: string | undefined, command: Command) => Promise<void>;
}

export type ServerlessGraphQLResponse<T> = GraphQLResponse<Record<string, T>>;
