import fs from "fs-extra";

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", (err) => reject(err));
  });
}

export async function readFileOrStdin(path: string): Promise<string> {
  if (path === "-") {
    return readStdin();
  }
  return fs.readFile(path, "utf-8");
}

export function safeJsonParse(input: string): unknown {
  return JSON.parse(input);
}

export async function readJsonInput(
  data?: string,
  filePath?: string,
): Promise<unknown | undefined> {
  if (data && data.trim() !== "") {
    return safeJsonParse(data);
  }
  if (filePath && filePath.trim() !== "") {
    const content = await readFileOrStdin(filePath.trim());
    if (content.trim() === "") {
      return undefined;
    }
    return safeJsonParse(content);
  }
  return undefined;
}
