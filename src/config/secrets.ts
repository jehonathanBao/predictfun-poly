export const REDACTED_SECRET = "[REDACTED]";

const SECRET_KEY_PATTERN = /(?:private[_-]?key|jwt|api[_-]?secret|api[_-]?key|authorization|passphrase|token|secret)/i;
const SECRET_ASSIGNMENT_PATTERN =
  /\b((?:private[\s_-]?key|jwt|api[\s_-]?secret|api[\s_-]?key|authorization|passphrase|token|secret)\s*[:=]\s*)([^,\s;]+)/gi;

export const PINO_SECRET_REDACT_PATHS = [
  "privateKey",
  "private_key",
  "jwt",
  "authorization",
  "apiKey",
  "api_key",
  "apiSecret",
  "api_secret",
  "secret",
  "token",
  "passphrase",
  "predict.apiKey",
  "accounts.polymarketPrivateKey",
  "accounts.polymarketApiKey",
  "accounts.polymarketApiSecret",
  "accounts.polymarketPassphrase",
  "*.privateKey",
  "*.private_key",
  "*.jwt",
  "*.authorization",
  "*.apiKey",
  "*.api_key",
  "*.apiSecret",
  "*.api_secret",
  "*.secret",
  "*.token",
  "*.passphrase",
  "*.*.privateKey",
  "*.*.jwt",
  "*.*.apiKey",
  "*.*.apiSecret",
  "*.*.secret",
  "*.*.token",
  "*.*.passphrase"
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function maskSecretString(value: string): string {
  return value.replace(SECRET_ASSIGNMENT_PATTERN, `$1${REDACTED_SECRET}`);
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return maskSecretString(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (isDecimalLike(value)) return value;
  if (Array.isArray(value)) return value.map(redactValue);

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSecretKey(key) ? REDACTED_SECRET : redactValue(child);
  }
  return redacted;
}

function isDecimalLike(value: object): boolean {
  return value.constructor?.name === "Decimal" && typeof (value as { toFixed?: unknown }).toFixed === "function";
}
