export interface ReconcileCliResult {
  scheduled: boolean;
  message: string;
}

export async function reconcileCli(): Promise<ReconcileCliResult> {
  return {
    scheduled: true,
    message: "reconcile command is ready; wire repositories and adapters for live execution"
  };
}
