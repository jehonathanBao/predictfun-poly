export interface DryRunCliResult {
  market: string;
  simulated: boolean;
  message: string;
}

export async function runDryRun(market = "BTC"): Promise<DryRunCliResult> {
  return {
    market,
    simulated: true,
    message: "dry-run simulation uses fixtures and does not submit live orders"
  };
}
