import { GlobalOptions } from "../../../utilities/shared/global-options";
import { CliServices } from "../../../utilities/shared/services";

export interface ApiCommandOptions {
  limit?: string;
  all?: boolean;
  maxRecords?: string;
  filter?: string;
  include?: string;
  cursor?: string;
  sort?: string;
  order?: string;
  fields?: string;
  param?: string[];
  data?: string;
  file?: string;
  set?: string[];
  yes?: boolean;
  ids?: string;
  format?: string;
  output?: string;
  outputFile?: string;
  batchSize?: string;
  concurrency?: string;
  dryRun?: boolean;
  continueOnError?: boolean;
  field?: string;
  fieldsList?: string;
  source?: string;
  target?: string;
  priority?: string;
}

export interface ApiOperationContext {
  object: string;
  arg?: string;
  arg2?: string;
  options: ApiCommandOptions;
  services: CliServices;
  globalOptions: GlobalOptions;
}
