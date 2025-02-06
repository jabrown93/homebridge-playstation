import {
  API,
  Logger,
  PlatformConfig,
  Service,
  Characteristic,
  DynamicPlatformPlugin,
  PlatformAccessory,
} from 'homebridge';

import { PlaystationAccessory } from './playstationAccessory.js';
import { Discovery } from 'playactor/dist/discovery.js';

export interface PlaystationPlatformConfig extends PlatformConfig {
  pollInterval?: number;
  overrides?: Array<{ deviceId: string; name?: string }>;
  apps?: Array<{ id: string; name: string }>;
}

export class PlaystationPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly playstationAccessories: Map<string, PlaystationAccessory> =
    new Map();

  public readonly existingAccessories: Map<string, PlatformAccessory> =
    new Map();

  public readonly kDefaultPollInterval = 15_000;

  constructor(
    public readonly log: Logger,
    public readonly config: PlaystationPlatformConfig,
    public readonly api: API
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.log.debug('Config', JSON.stringify(config));
    this.log.info('Discovering devices...');
    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');
      await this.discoverDevices().catch(err => {
        this.log.error((err as Error).message);
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.existingAccessories.set(accessory.UUID, accessory);
  }

  async discoverDevices() {
    const discovery = new Discovery();
    const devices = discovery.discover();

    for await (const deviceInformation of devices) {
      this.log.debug('Discovered device:', JSON.stringify(deviceInformation));
      const accessory = new PlaystationAccessory(this, deviceInformation);
      await accessory.init();
      this.playstationAccessories.set(deviceInformation.id, accessory);
    }
    this.log.debug('Finished discovering devices');
  }
}
