import { type Redis } from "ioredis";

export interface LockHandle {
  key: string;
  token: string;
}

export interface LockManager {
  acquire(key: string, token: string, ttlMs: number): Promise<LockHandle | null>;
  release(handle: LockHandle): Promise<void>;
}

export class RedisLockManager implements LockManager {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, token: string, ttlMs: number): Promise<LockHandle | null> {
    const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? { key, token } : null;
  }

  async release(handle: LockHandle): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;
    await this.redis.eval(script, 1, handle.key, handle.token);
  }
}
