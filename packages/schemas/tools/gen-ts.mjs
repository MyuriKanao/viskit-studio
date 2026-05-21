// AUTO-GENERATED runner — generates packages/schemas/ts/index.ts from openapi.yaml
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const input = resolve(root, "openapi.yaml");
const output = resolve(root, "ts", "index.ts");

const banner = "// AUTO-GENERATED from packages/schemas/openapi.yaml — do not edit by hand\n";

// Try programmatic API first, fall back to CLI
let generated;
try {
  const { default: openapiTS, astToString } = await import("openapi-typescript");
  const ast = await openapiTS(new URL(`file://${input}`));
  generated = typeof ast === "string" ? ast : astToString(ast);
} catch (e) {
  // Fallback: shell out to the CLI
  const cli = resolve(root, "node_modules", ".bin", "openapi-typescript");
  generated = execSync(`${cli} "${input}"`, { encoding: "utf8" });
}

writeFileSync(output, banner + generated, "utf8");
console.log("✓ generated TypeScript types at", output);
