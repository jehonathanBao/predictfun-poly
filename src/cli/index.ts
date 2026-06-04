import { readFile } from "node:fs/promises";
import { doctor } from "./doctor.js";
import { runDryRun } from "./dry-run.js";
import { parsePredictAccountsCsv } from "./import-predict-accounts.js";
import { parsePolymarketAccount } from "./import-polymarket-account.js";
import { reconcileCli } from "./reconcile.js";

async function main(argv: readonly string[]): Promise<unknown> {
  const [command, subcommand, ...rest] = argv;
  if (command === "doctor") return doctor();
  if (command === "dry-run") return runDryRun(flagValue(rest, "--market") ?? "BTC");
  if (command === "reconcile") return reconcileCli();
  if (command === "import-predict-accounts") {
    const file = flagValue(rest, "--file");
    if (!file) throw new Error("import-predict-accounts requires --file accounts.csv");
    return parsePredictAccountsCsv(await readFile(file, "utf8"));
  }
  if (command === "import-polymarket-account") {
    return parsePolymarketAccount("poly-main", process.env.POLYMARKET_FUNDER_ADDRESS ?? "");
  }
  if (command === "cli" && subcommand) return main([subcommand, ...rest]);
  throw new Error("usage: pnpm cli <doctor|dry-run|reconcile|import-predict-accounts|import-polymarket-account>");
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

main(process.argv.slice(2))
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
