import { ConfigService } from "../../config/services/config.service";
import { CliError } from "../../errors/cli-error";

interface GraphqlSubscriptionResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface SseMessage {
  event?: string;
  data?: string;
}

export interface MetadataSubscriptionServiceOptions {
  workspace?: string;
  debug?: boolean;
}

export interface MetadataSubscriptionRequest {
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
}

export class MetadataSubscriptionService {
  constructor(
    private readonly configService: ConfigService = new ConfigService(),
    private readonly options: MetadataSubscriptionServiceOptions = {},
  ) {}

  async *subscribe<T>(request: MetadataSubscriptionRequest): AsyncGenerator<T> {
    const resolved = await this.configService.getConfig({
      workspace: this.options.workspace,
    });
    const url = `${resolved.apiUrl.replace(/\/+$/, "")}/metadata`;

    if (this.options.debug) {
      // eslint-disable-next-line no-console
      console.error(`→ SUBSCRIBE ${url}`);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        query: request.query,
        variables: request.variables ?? {},
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new CliError(
        `Metadata subscription request failed with status ${response.status}.${detail ? ` ${detail}` : ""}`,
        "API_ERROR",
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const detail = await response.text();
      throw new CliError(
        `Metadata subscription endpoint did not return an event stream.${detail ? ` ${detail}` : ""}`,
        "API_ERROR",
      );
    }

    const body = response.body;
    if (!body) {
      throw new CliError(
        "Metadata subscription response did not include a readable body.",
        "API_ERROR",
      );
    }

    try {
      for await (const message of parseEventStream(body)) {
        const event = message.event ?? "message";

        if (event === "complete") {
          break;
        }

        if (event !== "next" && event !== "message") {
          continue;
        }

        if (!message.data) {
          continue;
        }

        const payload = parseGraphqlPayload<T>(message.data);
        if (Array.isArray(payload.errors) && payload.errors.length > 0) {
          throw new CliError(
            payload.errors
              .map((error) => error.message?.trim())
              .filter((message): message is string => Boolean(message))
              .join("\n") || "Metadata subscription returned an error payload.",
            "API_ERROR",
          );
        }

        if (payload.data !== undefined) {
          yield payload.data;
        }
      }
    } finally {
      await body.cancel().catch(() => undefined);
    }
  }
}

async function* parseEventStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const message = parseSseBlock(block);

        if (message) {
          yield message;
        }

        separatorIndex = buffer.indexOf("\n\n");
      }

      if (done) {
        const finalMessage = parseSseBlock(buffer);
        if (finalMessage) {
          yield finalMessage;
        }
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): SseMessage | undefined {
  const trimmed = block.trim();
  if (!trimmed) {
    return undefined;
  }

  let event: string | undefined;
  const data: string[] = [];

  for (const line of trimmed.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  if (!event && data.length === 0) {
    return undefined;
  }

  return {
    event,
    data: data.length > 0 ? data.join("\n") : undefined,
  };
}

function parseGraphqlPayload<T>(raw: string): GraphqlSubscriptionResponse<T> {
  try {
    return JSON.parse(raw) as GraphqlSubscriptionResponse<T>;
  } catch (error) {
    throw new CliError(
      `Failed to parse metadata subscription payload: ${error instanceof Error ? error.message : "unknown error"}`,
      "API_ERROR",
    );
  }
}
