import { PlatformConfig } from 'homebridge';

export interface PlaystationPlatformConfig extends PlatformConfig {
  pollInterval?: number;
  pollLockTimeout?: number;
  pollLockExecutionTimeout?: number;
  pollLockOccupationTimeout?: number;
  writeLockTimeout?: number;
  writeLockExecutionTimeout?: number;
  writeLockOccupationTimeout?: number;
  lockMaxPending?: number;
  overrides?: Array<{ deviceId: string; name?: string }>;
  apps?: Array<{ id: string; name: string }>;
}
