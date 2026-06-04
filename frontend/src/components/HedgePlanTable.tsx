import type { HedgePlan } from "../types";

interface HedgePlanTableProps {
  plans: readonly HedgePlan[];
  selectedMarketId?: string;
  onSelect: (plan: HedgePlan) => void;
}

export function HedgePlanTable({ plans, selectedMarketId, onSelect }: HedgePlanTableProps) {
  return (
    <div className="tableShell">
      <table>
        <thead>
          <tr>
            <th>Market</th>
            <th>Event</th>
            <th>Direction</th>
            <th className="number">Net</th>
            <th className="number">Hedge</th>
            <th>Hedge Market</th>
            <th>Reject</th>
            <th>Risk Codes</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr
              key={`${plan.eventKey}:${plan.marketId}`}
              className={selectedMarketId === plan.marketId ? "selected" : undefined}
              onClick={() => onSelect(plan)}
            >
              <td>
                <span className="mono">{plan.marketId}</span>
              </td>
              <td>
                <span className="mono mutedText">{plan.eventKey}</span>
              </td>
              <td>
                <span className={`badge ${plan.hedgeDirection.toLowerCase()}`}>
                  {plan.hedgeDirection}
                </span>
              </td>
              <td className="number">${formatNumber(plan.netExposureUsd)}</td>
              <td className="number">${formatNumber(plan.hedgeSizeUsd)}</td>
              <td>
                <span className="mono">{plan.hedgeMarketId ?? "-"}</span>
              </td>
              <td>{plan.rejectReason ?? "-"}</td>
              <td>
                <div className="riskCodeList">
                  {plan.riskCodes.length === 0 ? (
                    <span className="riskCode ok">OK</span>
                  ) : (
                    plan.riskCodes.map((code) => (
                      <span className="riskCode" key={`${plan.marketId}:${code}`}>
                        {code}
                      </span>
                    ))
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}
