import { API } from 'homebridge';

import { PLATFORM_NAME } from './settings.js';
import { PlaystationPlatform } from './playstationPlatform.js';

export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, PlaystationPlatform);
};
