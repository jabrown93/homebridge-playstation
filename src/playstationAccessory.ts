import {
  API,
  Characteristic,
  CharacteristicValue,
  Logging,
  PlatformAccessory,
  Service,
} from 'homebridge';
import { Device } from 'playactor/dist/device.js';
import {
  DeviceStatus,
  IDiscoveredDevice,
} from 'playactor/dist/discovery/model.js';

import { PlaystationPlatform } from './playstationPlatform.js';
import { PLUGIN_NAME } from './settings.js';
import { IDeviceConnection } from 'playactor/dist/connection/model.js';
import AsyncLock, { AsyncLockOptions } from 'async-lock';
import { ISocketConfig } from 'playactor/dist/socket/model';

export class PlaystationAccessory {
  private readonly accessory: PlatformAccessory;
  private readonly tvService: Service;

  private readonly api: API;
  private readonly log: Logging;
  private readonly Service: typeof Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly lock: AsyncLock;

  // list of titles that can be started through Home app
  private titleIDs: unknown[] = [];

  private readonly LOCK_OPTIONS: AsyncLockOptions = {
    timeout: 25_000,
    maxPending: 2,
    maxExecutionTime: 20_000,
  };

  private readonly SOCKET_OPTIONS: ISocketConfig = {
    connectTimeoutMillis: 10_000,
    maxRetries: 2,
    retryBackoffMillis: 1000,
  };

  constructor(
    private readonly platform: PlaystationPlatform,
    private deviceInformation: IDiscoveredDevice
  ) {
    this.Service = this.platform.Service;
    this.Characteristic = this.platform.Characteristic;
    this.api = this.platform.api;
    this.lock = new AsyncLock();

    const uuid = this.api.hap.uuid.generate(deviceInformation.id);
    const overrides = this.getOverrides();

    const deviceName = overrides?.name || deviceInformation.name;

    // @ts-expect-error - private property
    this.log = {
      ...this.platform.log,
      prefix: this.platform.log.prefix + `/${deviceName}`,
    };

    this.accessory = new this.api.platformAccessory<{
      deviceInformation: IDiscoveredDevice;
    }>(deviceName, uuid);
    this.accessory.category = this.api.hap.Categories.TV_SET_TOP_BOX;

    this.accessory
      .getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sony')
      .setCharacteristic(this.Characteristic.Model, deviceInformation.type)
      .setCharacteristic(this.Characteristic.SerialNumber, deviceInformation.id)
      .setCharacteristic(
        this.Characteristic.FirmwareRevision,
        deviceInformation.systemVersion
      );

    this.tvService =
      this.accessory.getService(this.Service.Television) ||
      this.accessory.addService(this.Service.Television);

    this.tvService
      .setCharacteristic(this.Characteristic.ConfiguredName, deviceName)
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
      );

    this.tvService
      .getCharacteristic(this.Characteristic.Active)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // These characteristics are required but not implemented yet
    this.tvService
      .getCharacteristic(this.Characteristic.RemoteKey)
      .onSet((newValue: CharacteristicValue) => {
        this.log.debug('Set RemoteKey is not implemented yet', newValue);
      });

    this.tvService.setCharacteristic(this.Characteristic.ActiveIdentifier, 0);

    this.setTitleList();

    this.tvService
      .getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(this.setTitleSwitchState.bind(this));

    setInterval(
      this.updateDeviceInformation.bind(this),
      this.platform.config.pollInterval || this.platform.kDefaultPollInterval
    );

    this.log.debug('Accessory created, publishing...');
    this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  private getOverrides() {
    const overrides = this.platform.config.overrides || [];
    return overrides.find(
      override => override.deviceId === this.deviceInformation.id
    );
  }

  private setTitleList() {
    // if nothing selected yet, add a placeholder
    this.addTitleToList('CUSAXXXXXX', '', 0);
    const titleList = this.platform.config.apps ?? [];
    if (titleList.length === 0) {
      this.log.warn('No apps configured, setting up a placeholder');
    }
    titleList.forEach((title, index) => {
      this.log.debug('Adding input for title: ', title);
      this.addTitleToList(title.id, title.name, index + 1);
    });
  }

  private addTitleToList(titleId: string, titleName: string, index: number) {
    const titleInputSource = new this.Service.InputSource(titleName, titleId);
    titleInputSource
      .setCharacteristic(this.Characteristic.Identifier, index)
      .setCharacteristic(this.Characteristic.Name, titleName)
      .setCharacteristic(this.Characteristic.ConfiguredName, titleName)
      .setCharacteristic(
        this.Characteristic.IsConfigured,
        this.Characteristic.IsConfigured.CONFIGURED
      )
      .setCharacteristic(
        this.Characteristic.InputSourceType,
        this.Characteristic.InputSourceType.APPLICATION
      )
      .setCharacteristic(
        this.Characteristic.CurrentVisibilityState,
        this.Characteristic.CurrentVisibilityState.SHOWN
      );

    this.accessory.addService(titleInputSource);
    this.tvService.addLinkedService(titleInputSource);

    this.titleIDs.push(titleId);
  }

  private notifyCharacteristicsUpdate() {
    this.tvService.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.deviceInformation.status === DeviceStatus.AWAKE
    );

    const runningAppTitle = this.titleIDs.indexOf(
      this.deviceInformation.extras['running-app-titleid'] || 0
    );
    this.tvService.updateCharacteristic(
      this.platform.Characteristic.ActiveIdentifier,
      runningAppTitle === -1 ? 0 : runningAppTitle
    );

    this.log.debug('Device status updated to:', this.deviceInformation.status);
  }

  private async updateDeviceInformation() {
    return this.lock
      .acquire(
        'update',
        async () => {
          const device = Device.withId(this.deviceInformation.id);
          this.deviceInformation = await device.discover();
          this.log.debug(
            'Device information updated:',
            JSON.stringify(this.deviceInformation)
          );
        },
        this.LOCK_OPTIONS
      )
      .catch(err => {
        this.log.error('Error updating', err);
        // If we can't discover the device, it's probably OFF
        this.deviceInformation.status = DeviceStatus.STANDBY;
      })
      .finally(() => this.notifyCharacteristicsUpdate());
  }

  private async setOn(value: CharacteristicValue) {
    let connection: IDeviceConnection | undefined;
    this.lock
      .acquire(
        'update',
        async () => {
          this.log.debug('setOn:', value);
          this.log.debug('Discovering device...');
          const device = Device.withId(this.deviceInformation.id);
          this.deviceInformation = await device.discover();
          if (
            (value && this.deviceInformation.status === DeviceStatus.AWAKE) ||
            (!value && this.deviceInformation.status === DeviceStatus.STANDBY)
          ) {
            this.log.debug('Already in desired state');
            this.notifyCharacteristicsUpdate();
            return;
          }
          if (value) {
            this.log.debug('Waking device...');
            return await device.wake().then(() => {
              this.log.debug('Device is now awake');
            });
          }
          this.log.debug('Opening connection...');
          connection = await device.openConnection({
            socket: this.SOCKET_OPTIONS,
          });
          this.log.debug('Standby device...');
          return await connection.standby().then(() => {
            this.log.debug('Device is now in standby');
          });
        },
        { ...this.LOCK_OPTIONS, skipQueue: true }
      )
      .catch(err => {
        this.log.error('Error setting status', err);
      })
      .finally(() => connection?.close());
    this.notifyCharacteristicsUpdate();
  }

  private async getOn(): Promise<CharacteristicValue> {
    return this.deviceInformation.status === DeviceStatus.AWAKE;
  }

  private async setTitleSwitchState(value: CharacteristicValue) {
    let connection: IDeviceConnection | undefined;
    this.lock
      .acquire(
        'update',
        async () => {
          this.log.debug('setTitleSwitchState: ', value);

          const requestedTitle =
            (this.titleIDs[value as number] as string) || null;

          if (!requestedTitle) {
            this.log.debug('No title found for index: ', value);
            return;
          }

          if (
            this.deviceInformation.extras['running-app-titleid'] ===
            requestedTitle
          ) {
            this.log.debug('Title already running');
            this.notifyCharacteristicsUpdate();
            return;
          }
          const device = Device.withId(this.deviceInformation.id);
          this.log.debug(`Starting title ${requestedTitle} ...`);
          connection = await device.openConnection({
            socket: this.SOCKET_OPTIONS,
          });

          await connection.startTitleId?.(requestedTitle);
        },
        this.LOCK_OPTIONS
      )
      .catch(err => {
        this.log.error('Error setting title switch state', err);
      })
      .finally(() => connection?.close());
  }
}
