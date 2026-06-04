import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { loadConfigFromEnv, normalizeConfig } from "./schema.js";

export { loadConfigFromEnv } from "./schema.js";
export type { AppConfig, RawAppConfig } from "./schema.js";

export async function loadConfigFromFile(
  filePath = path.resolve("src/config/default.yaml"),
  env: NodeJS.ProcessEnv = process.env
) {
  const contents = await readFile(filePath, "utf8");
  return normalizeConfig(parse(contents), env);
}
