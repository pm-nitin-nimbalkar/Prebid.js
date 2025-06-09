import { submodule } from '../src/hook.js';
import { logError, logInfo, isStr, isPlainObject, isEmpty, isFn, mergeDeep } from '../src/utils.js';
import { config as conf } from '../src/config.js';
import { getDeviceType as fetchDeviceType, getOS } from '../libraries/userAgentUtils/index.js';
import { getLowEntropySUA } from '../src/fpd/sua.js';
import { continueAuction } from './priceFloors.js'; // eslint-disable-line prebid/validate-imports

// Type definition for SUA result
interface SuaResult {
  browsers?: Array<{ brand: string }>;
}

// Add strict type for RTD config
interface RtdConfig {
  auctionDelay?: number;
  [key: string]: any;
}

// ======================== Type Definitions ========================

/**
 * Configuration for the PubMatic RTD module
 */
export interface PubmaticRtdConfig {
  params: {
    publisherId: string;
    profileId: string;
  };
}

/**
 * Configuration profile from PubMatic
 */
export interface ProfileConfig {
  plugins?: {
    dynamicFloors?: {
      enabled: boolean;
      config?: FloorConfigOptions;
      skipRate?: number;
      defaultValues?: Record<string, any>;
      pmTargetingKeys?: {
        enabled: boolean;
        multiplier?: {
          win?: number;
          floored?: number;
          nobid?: number;
        };
      };
    };
  };
}

/**
 * Floor data returned from the API
 */
export interface FloorsData {
  currency: string;
  skipRate: number;
  schema: {
    fields: string[];
  };
  values?: Record<string, any>;
  multiplier?: {
    win?: number;
    floored?: number;
    nobid?: number;
  };
}

/**
 * Floor configuration options
 */
export interface FloorConfigOptions {
  enabled?: boolean;
  skipRate?: number;
  defaultValues?: Record<string, any>;
  enforcement?: {
    enforceJS?: boolean;
    enforcePBS?: boolean;
    floorDeals?: boolean;
    bidAdjustment?: boolean;
  };
  [key: string]: any;
}

/**
 * RTD Submodule interface - aligns with Prebid.js expectations
 */
export interface RtdSubmodule {
  /** Name of the submodule */
  name: string;
  /** 
   * Initialization function 
   * @param config Configuration provided by Prebid.js
   * @param userConsent Consent data
   * @returns boolean indicating successful initialization
   */
  init: (config: { params: Record<string, any>; [key: string]: any }, userConsent?: any) => boolean;
  /** 
   * Function to get bid request data 
   * @param reqBidsConfigObj Request bids configuration
   * @param callback Callback function to continue auction
   * @param config Optional configuration
   * @param userConsent Optional user consent data
   */
  getBidRequestData: (reqBidsConfigObj: any, callback: () => void, config?: any, userConsent?: any) => void;
  /** 
   * Optional function to get targeting data 
   * @param adUnitCodes Array of ad unit codes
   * @param config Optional configuration
   * @param userConsent Optional user consent data
   * @param auction Optional auction data
   */
  getTargetingData?: (adUnitCodes: string[], config?: any, userConsent?: any, auction?: any) => Record<string, Record<string, any>>;
}

/**
 * Browser regex map entry
 */
interface BrowserRegexMap {
  regex: RegExp;
  id: number;
}

/**
 * Hook configuration for auction
 */
interface HookConfig {
  reqBidsConfigObj: any;
  context: any;
  nextFn: () => boolean;
  haveExited: boolean;
  timer: number | null;
}

// ======================== Constants ========================

/**
 * Constants used throughout the module
 */
const CONSTANTS = Object.freeze({
  SUBMODULE_NAME: 'pubmatic',
  REAL_TIME_MODULE: 'realTimeData',
  LOG_PRE_FIX: 'PubMatic-Rtd-Provider: ',
  UTM: 'utm_',
  UTM_VALUES: {
    TRUE: '1',
    FALSE: '0'
  },
  TIME_OF_DAY_VALUES: {
    MORNING: 'morning',
    AFTERNOON: 'afternoon',
    EVENING: 'evening',
    NIGHT: 'night',
  },
  ENDPOINTS: {
    BASEURL: 'https://ads.pubmatic.com/AdServer/js/pwt',
    FLOORS: 'floors.json',
    CONFIGS: 'config.json'
  }
});

/**
 * Default template for floor values
 */
export const defaultValueTemplate: Partial<FloorsData> = {
  currency: 'USD',
  skipRate: 0,
  schema: {
    fields: ['mediaType', 'size']
  }
};

/**
 * Browser regex mapping for detection
 */
const BROWSER_REGEX_MAP: BrowserRegexMap[] = [
  { regex: /\b(?:crios)\/([-\w\.]+)/i, id: 1 }, // Chrome for iOS
  { regex: /(edg|edge)(?:e|ios|a)?(?:\/([-\w\.]+))?/i, id: 2 }, // Edge
  { regex: /(opera|opr)(?:.+version\/|[\/\s]+)([-\w\.]+)/i, id: 3 }, // Opera
  { regex: /(?:ms|\()(ie) ([-\w\.]+)|(?:trident\/[-\w\.]+)/i, id: 4 }, // Internet Explorer
  { regex: /fxios\/([-\w\.]+)/i, id: 5 }, // Firefox for iOS
  { regex: /((?:fban\/fbios|fb_iab\/fb4a)(?!.+fbav)|;fbav\/([-\w\.]+);)/i, id: 6 }, // Facebook In-App Browser
  { regex: / wv\).+(chrome)\/([-\w\.]+)/i, id: 7 }, // Chrome WebView
  { regex: /droid.+ version\/([-\w\.]+)\b.+(?:mobile safari|safari)/i, id: 8 }, // Android Browser
  { regex: /(chrome|crios)(?:\/v?([-\w\.]+))?\b/i, id: 9 }, // Chrome
  { regex: /version\/([-\w.,]+) .*mobile\/\w+ (safari)/i, id: 10 }, // Safari Mobile
  { regex: /version\/([-\w(\.|,)]+) .*(mobile ?safari|safari)/i, id: 11 }, // Safari
  { regex: /(firefox)\/([-\w\.]+)/i, id: 12 } // Firefox
];

// ======================== Module variables ========================

/**
 * Module state variables
 */
let initTime: number;
let _fetchFloorRulesPromise: Promise<FloorsData | undefined> | null = null;
let _fetchConfigPromise: Promise<ProfileConfig | undefined> | null = null;
export let configMerged: () => void;
let configMergedPromise = new Promise<void>((resolve) => { configMerged = resolve; });
export let _country: string | undefined;

// Optimize withTimeout function with better typing and error handling
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) return promise;
  
  let timeoutId: number;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => resolve(undefined), ms) as unknown as number;
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]).catch((error) => {
    logError(`${CONSTANTS.LOG_PRE_FIX} Timeout error:`, error);
    return undefined;
  });
}

/**
 * Gets the current time of day
 * @returns String representing time of day
 */
export const getCurrentTimeOfDay = (): string => {
  const currentHour = new Date().getHours();

  return currentHour < 5 ? CONSTANTS.TIME_OF_DAY_VALUES.NIGHT
    : currentHour < 12 ? CONSTANTS.TIME_OF_DAY_VALUES.MORNING
      : currentHour < 17 ? CONSTANTS.TIME_OF_DAY_VALUES.AFTERNOON
        : currentHour < 19 ? CONSTANTS.TIME_OF_DAY_VALUES.EVENING
          : CONSTANTS.TIME_OF_DAY_VALUES.NIGHT;
};

// Optimize getBrowserType with better error handling and caching
let cachedBrowserType: string | null = null;
export const getBrowserType = (): string => {
  if (cachedBrowserType !== null) {
    return cachedBrowserType;
  }

  try {
    const sua = getLowEntropySUA() as SuaResult | undefined;
    const brandName = sua?.browsers
      ?.map(b => b.brand.toLowerCase())
      .join(' ') || '';
    
    const browserMatch = brandName ? 
      BROWSER_REGEX_MAP.find(({ regex }) => regex.test(brandName)) : 
      undefined;

    if (browserMatch?.id) {
      cachedBrowserType = browserMatch.id.toString();
      return cachedBrowserType;
    }

    const userAgent = navigator?.userAgent;
    if (!userAgent) {
      cachedBrowserType = '0';
      return cachedBrowserType;
    }

    const match = BROWSER_REGEX_MAP.find(({ regex }) => regex.test(userAgent));
    cachedBrowserType = (match?.id || 0).toString();
    return cachedBrowserType;
  } catch (error) {
    logError(`${CONSTANTS.LOG_PRE_FIX} Error getting browser type:`, error);
    cachedBrowserType = '0';
    return cachedBrowserType;
  }
};

/**
 * Gets the operating system
 * @returns String representing OS
 */
export const getOs = (): string => getOS().toString();

/**
 * Gets the device type
 * @returns String representing device type
 */
export const getDeviceType = (): string => fetchDeviceType().toString();

/**
 * Gets the country code
 * @returns Country code string or undefined
 */
export const getCountry = (): string | undefined => _country;

// Optimize getUtm with better error handling and caching
let cachedUtmValue: string | null = null;
export const getUtm = (): string => {
  if (cachedUtmValue !== null) {
    return cachedUtmValue;
  }

  try {
    const url = new URL(window.location?.href || '');
    const urlParams = new URLSearchParams(url?.search);
    cachedUtmValue = urlParams && urlParams.toString().includes(CONSTANTS.UTM) ? 
      CONSTANTS.UTM_VALUES.TRUE : 
      CONSTANTS.UTM_VALUES.FALSE;
    return cachedUtmValue;
  } catch (error) {
    logError(`${CONSTANTS.LOG_PRE_FIX} Error getting UTM:`, error);
    cachedUtmValue = CONSTANTS.UTM_VALUES.FALSE;
    return cachedUtmValue;
  }
};

// ======================== Data Processing Functions ========================

/**
 * Processes floor configuration from data and profile config
 * @param floorsData Floor data from API
 * @param profileConfigs Profile configuration
 * @returns Floor configuration object or undefined
 */
export const getFloorsConfig = (
  floorsData: FloorsData | undefined, 
  profileConfigs: ProfileConfig | undefined
): any | undefined => {
  // Type guard for profileConfigs
  if (!isPlainObject(profileConfigs) || isEmpty(profileConfigs)) {
    logError(`${CONSTANTS.LOG_PRE_FIX} profileConfigs is not an object or is empty`);
    return undefined;
  }

  // Floor configs from adunit / setconfig
  const defaultFloorConfig = conf.getConfig('floors') ?? {};
  if (defaultFloorConfig?.endpoint) {
    delete defaultFloorConfig.endpoint;
  }
  
  // Type assertion to use the proper ProfileConfig interface
  const typedConfig = profileConfigs as ProfileConfig;
  
  // Plugin data from profile
  const dynamicFloors = typedConfig.plugins?.dynamicFloors;

  // If plugin disabled or config not present, return undefined
  if (!dynamicFloors?.enabled || !dynamicFloors?.config) {
    return undefined;
  }

  const config = { ...dynamicFloors.config };

  // default values provided by publisher on profile
  const defaultValues = config.defaultValues ?? {};
  // If floorsData is not present, use default values
  const finalFloorsData = floorsData ?? { ...defaultValueTemplate, values: { ...defaultValues } };

  delete config.defaultValues;
  // If skiprate is provided in configs, overwrite the value in finalFloorsData
  (config.skipRate !== undefined) && (finalFloorsData.skipRate = config.skipRate);

  // merge default configs from page, configs
  return {
    floors: {
      ...defaultFloorConfig,
      ...config,
      data: finalFloorsData,
      additionalSchemaFields: {
        deviceType: getDeviceType,
        timeOfDay: getCurrentTimeOfDay,
        browser: getBrowserType,
        os: getOs,
        utm: getUtm,
        country: getCountry,
      },
    },
  };
};

// Optimize fetchData with better error handling and retries
export const fetchData = async (
  publisherId: string, 
  profileId: string, 
  type: 'FLOORS' | 'CONFIGS',
  retries = 2
): Promise<FloorsData | ProfileConfig | undefined> => {
  try {
    const endpoint = CONSTANTS.ENDPOINTS[type];
    const baseURL = (type === 'FLOORS') ? 
      `${CONSTANTS.ENDPOINTS.BASEURL}/floors` : 
      CONSTANTS.ENDPOINTS.BASEURL;
    const url = `${baseURL}/${publisherId}/${profileId}/${endpoint}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (type === "FLOORS") {
      const cc = response.headers?.get('country_code');
      _country = cc ? cc.split(',')?.map(code => code.trim())[0] : undefined;
    }

    return await response.json();
  } catch (error) {
    if (retries > 0) {
      logInfo(`${CONSTANTS.LOG_PRE_FIX} Retrying ${type} fetch, attempts remaining: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
      return fetchData(publisherId, profileId, type, retries - 1);
    }
    logError(`${CONSTANTS.LOG_PRE_FIX} Error while fetching ${type}:`, error);
    return undefined;
  }
};

// ======================== Core RTD Module Functions ========================

/**
 * Interface for request bids configuration object
 */
interface ReqBidsConfigObject {
  ortb2Fragments: {
    bidder: Record<string, any>;
  };
  [key: string]: any;
}

/**
 * Initialize the Pubmatic RTD Module.
 * @param config Module configuration
 * @param userConsent User consent data
 * @returns boolean indicating success
 */
const init = (config: { params: Record<string, any>; [key: string]: any }, userConsent?: any): boolean => {
  try {
    initTime = Date.now();
    
    const params = config?.params || {};
    const publisherId = params.publisherId;
    const profileId = params.profileId;

    if (!publisherId || !isStr(publisherId)) {
      throw new Error(!publisherId ? 'Missing publisher Id.' : 'Publisher Id should be a string.');
    }
    
    if (!profileId || !isStr(profileId)) {
      throw new Error(!profileId ? 'Missing profile Id.' : 'Profile Id should be a string.');
    }

    if (!isFn(continueAuction)) {
      throw new Error('continueAuction is not a function. Please ensure to add priceFloors module.');
    }

    const floorPromise = fetchData(publisherId, profileId, "FLOORS");
    const configPromise = fetchData(publisherId, profileId, "CONFIGS");
    
    _fetchFloorRulesPromise = floorPromise as Promise<FloorsData | undefined>;
    _fetchConfigPromise = configPromise as Promise<ProfileConfig | undefined>;

    _fetchConfigPromise
      .then(async (profileConfigs) => {
        try {
          const rtdConfig = conf.getConfig('realTimeData') || {};
          const configWithTypes = rtdConfig as RtdConfig;
          const auctionDelay = typeof configWithTypes.auctionDelay === 'number' ? configWithTypes.auctionDelay : 0;
          const maxWaitTime = Math.max(0.8 * auctionDelay, 0);
          const elapsedTime = Date.now() - initTime;
          const remainingTime = Math.max(maxWaitTime - elapsedTime, 0);
          
          const floorsData = await withTimeout(_fetchFloorRulesPromise as Promise<FloorsData>, remainingTime);
          const floorsConfig = getFloorsConfig(floorsData, profileConfigs);
          
          if (floorsConfig) {
            conf.setConfig(floorsConfig);
          }
        } catch (error) {
          logError(`${CONSTANTS.LOG_PRE_FIX} Error processing floors data:`, error);
        } finally {
          configMerged();
        }
      })
      .catch((error) => {
        logError(`${CONSTANTS.LOG_PRE_FIX} Error fetching configuration:`, error);
        configMerged();
      });

    return true;
  } catch (error) {
    logError(`${CONSTANTS.LOG_PRE_FIX} Initialization error:`, error);
    return false;
  }
};

/**
 * Process bid request data with RTD information
 * @param reqBidsConfigObj Request bids configuration object
 * @param callback Callback to execute when done
 * @param config Optional configuration
 * @param userConsent Optional user consent data
 */
const getBidRequestData = (
  reqBidsConfigObj: ReqBidsConfigObject, 
  callback: () => void, 
  config?: any, 
  userConsent?: any
): void => {
  if (!reqBidsConfigObj || typeof reqBidsConfigObj !== 'object') {
    logError(`${CONSTANTS.LOG_PRE_FIX} Invalid bid request config object`);
    callback();
    return;
  }
  
  if (!reqBidsConfigObj.ortb2Fragments) {
    reqBidsConfigObj.ortb2Fragments = { bidder: {} };
  } else if (!reqBidsConfigObj.ortb2Fragments.bidder) {
    reqBidsConfigObj.ortb2Fragments.bidder = {};
  }

  configMergedPromise
    .then(() => {
      try {
        const hookConfig: HookConfig = {
          reqBidsConfigObj,
          context: null,
          nextFn: () => true,
          haveExited: false,
          timer: null
        };
        
        continueAuction(hookConfig);
        
        if (_country) {
          const ortb2 = {
            user: {
              ext: {
                ctr: _country,
              }
            }
          };

          mergeDeep(reqBidsConfigObj.ortb2Fragments.bidder, {
            [CONSTANTS.SUBMODULE_NAME]: ortb2
          });
        }
      } catch (error) {
        logError(`${CONSTANTS.LOG_PRE_FIX} Error in processing bid request data:`, error);
      } finally {
        callback();
      }
    })
    .catch((error) => {
      logError(`${CONSTANTS.LOG_PRE_FIX} Error in updating floors:`, error);
      callback();
    });
};

/**
 * PubMatic RTD Submodule definition
 */
export const pubmaticSubmodule: RtdSubmodule = {
  name: CONSTANTS.SUBMODULE_NAME,
  init,
  getBidRequestData,
};

/**
 * Register the submodule with Prebid.js
 * 
 * Note: We use a type assertion here because Prebid.js may expect a different
 * interface than what we've defined, but we know our implementation is compatible
 * with the JavaScript expectations of the module system.
 */
export const registerSubModule = (): void => {
  // Use type assertion to handle mismatch between our interface and Prebid's expectations
  // This works because the JavaScript implementation is compatible even if TypeScript is unsure
  submodule(CONSTANTS.REAL_TIME_MODULE, pubmaticSubmodule as any);
};

// Auto-register the module when this file is loaded
registerSubModule();
