export interface DoctorCheck {
  name: string;
  ok: boolean;
  message?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: readonly DoctorCheck[];
}

export async function runStartupDoctor(checks: readonly (() => Promise<DoctorCheck> | DoctorCheck)[]): Promise<DoctorReport> {
  const results: DoctorCheck[] = [];
  for (const check of checks) {
    try {
      results.push(await check());
    } catch (error) {
      results.push({
        name: "unknown",
        ok: false,
        message: error instanceof Error ? error.message : "doctor check failed"
      });
    }
  }
  return {
    ok: results.every((check) => check.ok),
    checks: results
  };
}
