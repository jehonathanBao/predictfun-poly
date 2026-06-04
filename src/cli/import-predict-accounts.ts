import { predictAccount } from "../core/account-rotator.js";

export function parsePredictAccount(accountId: string, address: string) {
  return predictAccount({ accountId, address });
}

export interface ImportedPredictAccount {
  accountId: string;
  address: string;
  label?: string;
}

export function parsePredictAccountsCsv(contents: string): readonly ImportedPredictAccount[] {
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const [header, ...rows] = lines;
  if (!header) return [];
  const columns = header.split(",").map((value) => value.trim());
  const accountIdIndex = columns.indexOf("account_id");
  const addressIndex = columns.indexOf("address");
  const labelIndex = columns.indexOf("label");
  if (accountIdIndex < 0 || addressIndex < 0) {
    throw new Error("accounts.csv requires account_id and address columns");
  }
  const parsed = rows.map((row) => {
    const values = row.split(",").map((value) => value.trim());
    return {
      accountId: values[accountIdIndex] ?? "",
      address: values[addressIndex] ?? "",
      label: labelIndex >= 0 ? values[labelIndex] : undefined
    };
  });
  if (parsed.length > 10) throw new Error("at most 10 Predict accounts are supported");
  return parsed;
}
