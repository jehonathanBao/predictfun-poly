import {
  loadDryRunAlerts,
  type DryRunAlertsResponse,
} from "../analytics/hedge-dry-run-alerts.js";
import {
  loadDryRunReport,
  writeDailyDryRunReport,
  writeLatestDryRunReport,
  type DryRunReport,
} from "../analytics/hedge-dry-run-report.js";

export async function loadDashboardDryRunAlerts(limit?: number): Promise<DryRunAlertsResponse> {
  return loadDryRunAlerts({ limit });
}

export async function loadDashboardDryRunReport(limit?: number): Promise<DryRunReport> {
  const report = await loadDryRunReport({ limit });
  if (process.env.DASHBOARD_REPORT_ENABLED !== "false") {
    const reportsDir = process.env.DASHBOARD_REPORTS_DIR ?? "reports";
    await writeLatestDryRunReport(report, `${reportsDir}/hedge-dry-run-summary.latest.json`);
    await writeDailyDryRunReport(report, reportsDir);
  }
  return report;
}
