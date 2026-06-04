export interface DigitalMonteCarloInput {
  spotPrice: number;
  strikePrice: number;
  annualizedVol: number;
  timeToExpirySec: number;
  paths?: number;
  rng?: () => number;
}

export interface DigitalMonteCarloResult {
  probability: number;
  lower95: number;
  upper95: number;
  standardError: number;
  paths: number;
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export function estimateDigitalCallProbability(input: DigitalMonteCarloInput): DigitalMonteCarloResult {
  assertPositiveFinite("spotPrice", input.spotPrice);
  assertPositiveFinite("strikePrice", input.strikePrice);
  assertPositiveFinite("annualizedVol", input.annualizedVol);
  assertPositiveFinite("timeToExpirySec", input.timeToExpirySec);

  const paths = input.paths ?? 20_000;
  if (!Number.isInteger(paths) || paths <= 0) throw new Error("paths must be a positive integer");

  const rng = input.rng ?? Math.random;
  const timeYears = input.timeToExpirySec / SECONDS_PER_YEAR;
  const drift = -0.5 * input.annualizedVol ** 2 * timeYears;
  const volTerm = input.annualizedVol * Math.sqrt(timeYears);
  let wins = 0;

  for (let index = 0; index < paths; index += 1) {
    const terminalPrice = input.spotPrice * Math.exp(drift + volTerm * randNormal(rng));
    if (terminalPrice >= input.strikePrice) wins += 1;
  }

  const probability = wins / paths;
  const standardError = Math.sqrt((probability * (1 - probability)) / paths);

  return {
    probability,
    lower95: clamp01(probability - 1.96 * standardError),
    upper95: clamp01(probability + 1.96 * standardError),
    standardError,
    paths
  };
}

function randNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
