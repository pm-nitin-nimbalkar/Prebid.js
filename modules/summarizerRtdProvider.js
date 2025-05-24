/**
 * This module uses Chrome's Summarizer API to enhance bid requests with content summaries
 * and classifications for improved contextual targeting.
 * @module modules/summarizerRtdProvider
 */
import { submodule } from '../src/hook.js';
import { logInfo, logError, logWarn, mergeDeep } from '../src/utils.js';

/**
 * @typedef {import('../modules/rtdModule/index.js').RtdSubmodule} RtdSubmodule
 */

export const CONSTANTS = Object.freeze({
  SUBMODULE_NAME: 'summarizer',
  REAL_TIME_MODULE: 'realTimeData',
  LOG_PREFIX: 'Summarizer-RTD-Provider: ',
  DEFAULT_TIMEOUT: 200, // ms
  TARGETING_KEYS: {
    CONTENT_SUMMARY: 'content_summary',
    CONTENT_CATEGORY: 'content_category'
  }
});

/**
 * Checks if the Chrome Summarizer API is available in the current browser
 * @returns {boolean} True if the API is available
 */
export const isSummarizerAvailable = () => {
  return typeof navigator !== 'undefined' && 
         typeof navigator.summarizer !== 'undefined' && 
         typeof navigator.summarizer.summarize === 'function';
};

/**
 * Fetches a summary of the current page content using Chrome's Summarizer API
 * @param {number} timeout - Maximum time to wait for the summary in milliseconds
 * @returns {Promise<Object|null>} - Promise resolving to summary object or null if unavailable
 */
export const fetchContentSummary = async (timeout = CONSTANTS.DEFAULT_TIMEOUT) => {
  if (!isSummarizerAvailable()) {
    logWarn(`${CONSTANTS.LOG_PREFIX} Summarizer API not available in this browser`);
    return null;
  }

  try {
    // Create a promise that will resolve with the summary or reject after timeout
    const summaryPromise = navigator.summarizer.summarize();
    
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Summary request timed out')), timeout);
    });

    // Race the summary promise against the timeout
    const summary = await Promise.race([summaryPromise, timeoutPromise]);
    
    if (!summary) {
      logWarn(`${CONSTANTS.LOG_PREFIX} No summary available for this content`);
      return null;
    }
    
    logInfo(`${CONSTANTS.LOG_PREFIX} Successfully retrieved content summary`);
    return summary;
  } catch (error) {
    logError(`${CONSTANTS.LOG_PREFIX} Error fetching content summary:`, error);
    return null;
  }
};

/**
 * Extracts categories from a summary object
 * @param {Object} summary - The summary object from the Summarizer API
 * @returns {Array<string>} - Array of category strings
 */
export const extractCategories = (summary) => {
  if (!summary || !summary.topics || !Array.isArray(summary.topics)) {
    return [];
  }
  
  return summary.topics.map(topic => topic.trim().toLowerCase());
};

/**
 * Initialize the Summarizer RTD Module
 * @param {Object} config - Configuration object
 * @param {Object} userConsent - User consent data
 * @returns {boolean} - True if initialization was successful
 */
export const init = (config, userConsent) => {
  const moduleConfig = config?.params || {};
  
  // Check if module is properly configured
  if (!moduleConfig.enabled) {
    logInfo(`${CONSTANTS.LOG_PREFIX} Module is disabled in configuration`);
    return false;
  }
  
  // Check if Summarizer API is available
  if (!isSummarizerAvailable()) {
    logWarn(`${CONSTANTS.LOG_PREFIX} Summarizer API not available, module will not function`);
    // Still return true to allow the module to initialize, it will gracefully handle the API absence
    return true;
  }
  
  logInfo(`${CONSTANTS.LOG_PREFIX} Module initialized successfully`);
  return true;
};

/**
 * Adds content summary data to bid requests
 * @param {Object} reqBidsConfigObj - The bid request configuration object
 * @param {function} callback - Callback function to call when done
 * @param {Object} config - Module configuration
 * @param {Object} userConsent - User consent data
 */
export const getBidRequestData = async (reqBidsConfigObj, callback, config, userConsent) => {
  const moduleConfig = config?.params || {};
  const timeout = moduleConfig.timeout || CONSTANTS.DEFAULT_TIMEOUT;
  
  try {
    // Fetch content summary
    const summary = await fetchContentSummary(timeout);
    
    if (summary) {
      // Extract useful data from the summary
      const summaryText = summary.summary || '';
      const categories = extractCategories(summary);
      
      // Create ortb2 fragment with summary data
      const ortb2 = {
        site: {
          content: {
            // Add summary as content data
            data: [{
              name: 'summary',
              segment: [{
                value: summaryText
              }]
            }]
          },
          // Add categories if available
          cat: categories
        },
        user: {
          // Add interest categories based on content
          data: [{
            name: 'interests',
            segment: categories.map(category => ({
              value: category
            }))
          }]
        }
      };
      
      // Merge data into the bid request
      mergeDeep(reqBidsConfigObj.ortb2Fragments.global, ortb2);
      
      logInfo(`${CONSTANTS.LOG_PREFIX} Added content summary data to bid request`);
    }
  } catch (error) {
    logError(`${CONSTANTS.LOG_PREFIX} Error in getBidRequestData:`, error);
  }
  
  // Always call the callback to continue the auction
  callback();
};

/**
 * Returns targeting data for ad units
 * @param {string[]} adUnitCodes - Ad unit codes
 * @param {Object} config - Module configuration
 * @param {Object} userConsent - User consent data
 * @param {Object} auction - Auction object
 * @return {Object} - Targeting data for ad units
 */
export const getTargetingData = async (adUnitCodes, config, userConsent, auction) => {
  const moduleConfig = config?.params || {};
  
  // If targeting is disabled, return empty object
  if (moduleConfig.targeting === false) {
    return {};
  }
  
  try {
    // Fetch content summary
    const summary = await fetchContentSummary(moduleConfig.timeout || CONSTANTS.DEFAULT_TIMEOUT);
    
    if (!summary) {
      return {};
    }
    
    // Extract categories
    const categories = extractCategories(summary);
    const primaryCategory = categories.length > 0 ? categories[0] : '';
    
    // Create targeting data for each ad unit
    const targeting = adUnitCodes.reduce((acc, code) => {
      acc[code] = {
        [CONSTANTS.TARGETING_KEYS.CONTENT_CATEGORY]: primaryCategory
      };
      return acc;
    }, {});
    
    return targeting;
  } catch (error) {
    logError(`${CONSTANTS.LOG_PREFIX} Error in getTargetingData:`, error);
    return {};
  }
};

/** @type {RtdSubmodule} */
export const summarizerSubmodule = {
  /**
   * used to link submodule with realTimeData
   * @type {string}
   */
  name: CONSTANTS.SUBMODULE_NAME,
  init,
  getBidRequestData,
  getTargetingData
};

export const registerSubModule = () => {
  submodule(CONSTANTS.REAL_TIME_MODULE, summarizerSubmodule);
};

registerSubModule();
