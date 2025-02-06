import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { PlaystationPlatform } from './playstationPlatform';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, PlaystationPlatform);
};
