export interface PredictJwtProvider {
  jwtForAccount(accountId: string): Promise<string>;
}

export class EnvPredictJwtProvider implements PredictJwtProvider {
  constructor(private readonly mapping: Record<string, string>, private readonly env = process.env) {}

  async jwtForAccount(accountId: string): Promise<string> {
    const envName = this.mapping[accountId];
    if (!envName) throw new Error(`missing JWT env mapping for Predict account ${accountId}`);
    const value = this.env[envName];
    if (!value) throw new Error(`missing Predict JWT in env ${envName}`);
    return value;
  }
}

