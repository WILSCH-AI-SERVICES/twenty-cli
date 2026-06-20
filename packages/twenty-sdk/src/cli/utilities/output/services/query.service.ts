import jmespath from "jmespath";

export class QueryService {
  apply(data: unknown, expression: string): unknown {
    return jmespath.search(data, expression);
  }
}
