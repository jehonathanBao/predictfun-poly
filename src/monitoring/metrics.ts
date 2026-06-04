export interface MetricsSink {
  increment(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

export class NoopMetricsSink implements MetricsSink {
  increment(): void {}
  gauge(): void {}
}

export interface MetricSample {
  name: string;
  value: number;
  labels: Record<string, string>;
}

export class InMemoryMetricsSink implements MetricsSink {
  readonly counters = new Map<string, MetricSample>();
  readonly gauges = new Map<string, MetricSample>();

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    const current = this.counters.get(key);
    this.counters.set(key, {
      name,
      labels,
      value: (current?.value ?? 0) + 1
    });
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(metricKey(name, labels), { name, labels, value });
  }

  counterValue(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(metricKey(name, labels))?.value ?? 0;
  }
}

function metricKey(name: string, labels: Record<string, string>): string {
  const suffix = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  return `${name}{${suffix}}`;
}
