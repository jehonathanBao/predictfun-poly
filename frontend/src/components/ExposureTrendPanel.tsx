import type { DryRunSummary } from "../types";

export function ExposureTrendPanel({ summary }: { summary?: DryRunSummary }) {
  const timeline = [...(summary?.timeline ?? [])].slice(-10).reverse();
  const eventExposure = [...(summary?.eventExposure ?? [])].slice(0, 8);

  return (
    <section className="trendPanel" aria-label="dry-run exposure trend">
      <div className="trendHeader">
        <div>
          <h2>Exposure Trend</h2>
          <p>Recent dry-run observations</p>
        </div>
        <span className="trendMode">dry-run history</span>
      </div>

      <div className="trendGrid">
        <div className="trendTableShell">
          <h3>Timeline</h3>
          <table className="compactTable">
            <thead>
              <tr>
                <th>Generated</th>
                <th className="number">Plans</th>
                <th className="number">Approved</th>
                <th className="number">Rejected</th>
                <th className="number">Max Exposure</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={5}>No history</td>
                </tr>
              ) : (
                timeline.map((point) => (
                  <tr key={point.generatedAt}>
                    <td>{formatTimestamp(point.generatedAt)}</td>
                    <td className="number">{point.planCount}</td>
                    <td className="number">{point.approvedCount}</td>
                    <td className="number">{point.rejectedCount}</td>
                    <td className="number">${formatNumber(point.maxAbsExposureUsd)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="trendTableShell">
          <h3>Event Exposure</h3>
          <table className="compactTable">
            <thead>
              <tr>
                <th>Event</th>
                <th className="number">Latest</th>
                <th className="number">Max Abs</th>
                <th className="number">Obs</th>
              </tr>
            </thead>
            <tbody>
              {eventExposure.length === 0 ? (
                <tr>
                  <td colSpan={4}>No event exposure</td>
                </tr>
              ) : (
                eventExposure.map((event) => (
                  <tr key={event.eventKey}>
                    <td className="mono">{event.eventKey}</td>
                    <td className="number">${formatNumber(event.latestNetExposureUsd)}</td>
                    <td className="number">${formatNumber(event.maxAbsExposureUsd)}</td>
                    <td className="number">{event.observationCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
