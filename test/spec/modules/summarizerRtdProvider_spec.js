import { expect } from 'chai';
import sinon from 'sinon';
import * as summarizerRtdProvider from 'modules/summarizerRtdProvider.js';
import { config } from 'src/config.js';

describe('summarizerRtdProvider', function() {
  let sandbox;
  let mockSummarizer;
  let mockSummary;

  beforeEach(function() {
    sandbox = sinon.sandbox.create();
    
    // Mock summary data
    mockSummary = {
      summary: 'This is a test summary of the page content.',
      topics: ['Technology', 'Artificial Intelligence', 'Web Development']
    };
    
    // Mock navigator.summarizer
    mockSummarizer = {
      summarize: sandbox.stub().resolves(mockSummary)
    };
    
    // Add mock summarizer to navigator
    if (typeof navigator !== 'undefined') {
      navigator.summarizer = mockSummarizer;
    } else {
      global.navigator = { summarizer: mockSummarizer };
    }
  });

  afterEach(function() {
    sandbox.restore();
    config.resetConfig();
    
    // Clean up mock
    if (typeof navigator !== 'undefined') {
      delete navigator.summarizer;
    }
  });

  describe('isSummarizerAvailable', function() {
    it('should return true when summarizer API is available', function() {
      expect(summarizerRtdProvider.isSummarizerAvailable()).to.be.true;
    });

    it('should return false when summarizer API is not available', function() {
      delete navigator.summarizer;
      expect(summarizerRtdProvider.isSummarizerAvailable()).to.be.false;
    });
  });

  describe('fetchContentSummary', function() {
    it('should return summary when API call succeeds', async function() {
      const result = await summarizerRtdProvider.fetchContentSummary(500);
      expect(result).to.deep.equal(mockSummary);
      expect(mockSummarizer.summarize.calledOnce).to.be.true;
    });

    it('should return null when API is not available', async function() {
      delete navigator.summarizer;
      const result = await summarizerRtdProvider.fetchContentSummary(500);
      expect(result).to.be.null;
    });

    it('should handle timeout correctly', async function() {
      // Make the summarize function take longer than the timeout
      mockSummarizer.summarize = sandbox.stub().returns(new Promise(resolve => {
        setTimeout(() => resolve(mockSummary), 200);
      }));
      
      const result = await summarizerRtdProvider.fetchContentSummary(100);
      expect(result).to.be.null;
    });
  });

  describe('extractCategories', function() {
    it('should extract categories from summary object', function() {
      const categories = summarizerRtdProvider.extractCategories(mockSummary);
      expect(categories).to.deep.equal(['technology', 'artificial intelligence', 'web development']);
    });

    it('should return empty array for invalid input', function() {
      expect(summarizerRtdProvider.extractCategories(null)).to.deep.equal([]);
      expect(summarizerRtdProvider.extractCategories({})).to.deep.equal([]);
      expect(summarizerRtdProvider.extractCategories({ topics: 'not an array' })).to.deep.equal([]);
    });
  });

  describe('init', function() {
    it('should return false if module is disabled', function() {
      const config = { params: { enabled: false } };
      expect(summarizerRtdProvider.init(config)).to.be.false;
    });

    it('should return true if properly configured and API is available', function() {
      const config = { params: { enabled: true } };
      expect(summarizerRtdProvider.init(config)).to.be.true;
    });

    it('should return true even if API is not available', function() {
      delete navigator.summarizer;
      const config = { params: { enabled: true } };
      expect(summarizerRtdProvider.init(config)).to.be.true;
    });
  });

  describe('getBidRequestData', function() {
    let reqBidsConfigObj;
    let callback;

    beforeEach(function() {
      reqBidsConfigObj = {
        ortb2Fragments: {
          global: {}
        }
      };
      callback = sandbox.spy();
    });

    it('should add summary data to bid request when summary is available', async function() {
      const config = { params: { enabled: true, timeout: 500 } };
      
      await summarizerRtdProvider.getBidRequestData(reqBidsConfigObj, callback, config);
      
      expect(callback.calledOnce).to.be.true;
      expect(reqBidsConfigObj.ortb2Fragments.global).to.have.nested.property('site.content.data');
      expect(reqBidsConfigObj.ortb2Fragments.global.site.content.data[0].name).to.equal('summary');
      expect(reqBidsConfigObj.ortb2Fragments.global.site.cat).to.deep.equal(['technology', 'artificial intelligence', 'web development']);
    });

    it('should call callback even when summary fetch fails', async function() {
      mockSummarizer.summarize = sandbox.stub().rejects(new Error('API error'));
      const config = { params: { enabled: true } };
      
      await summarizerRtdProvider.getBidRequestData(reqBidsConfigObj, callback, config);
      
      expect(callback.calledOnce).to.be.true;
      expect(reqBidsConfigObj.ortb2Fragments.global).to.deep.equal({});
    });
  });

  describe('getTargetingData', function() {
    it('should return targeting data with content category', async function() {
      const adUnitCodes = ['ad1', 'ad2'];
      const config = { params: { enabled: true, timeout: 500 } };
      
      const targeting = await summarizerRtdProvider.getTargetingData(adUnitCodes, config);
      
      expect(targeting).to.have.property('ad1');
      expect(targeting).to.have.property('ad2');
      expect(targeting.ad1).to.have.property(summarizerRtdProvider.CONSTANTS.TARGETING_KEYS.CONTENT_CATEGORY, 'technology');
    });

    it('should return empty object when targeting is disabled', async function() {
      const adUnitCodes = ['ad1', 'ad2'];
      const config = { params: { targeting: false } };
      
      const targeting = await summarizerRtdProvider.getTargetingData(adUnitCodes, config);
      
      expect(targeting).to.deep.equal({});
    });

    it('should return empty object when summary fetch fails', async function() {
      mockSummarizer.summarize = sandbox.stub().rejects(new Error('API error'));
      const adUnitCodes = ['ad1', 'ad2'];
      const config = { params: { enabled: true } };
      
      const targeting = await summarizerRtdProvider.getTargetingData(adUnitCodes, config);
      
      expect(targeting).to.deep.equal({});
    });
  });

  describe('summarizerSubmodule', function() {
    it('should have the correct module structure', function() {
      expect(summarizerRtdProvider.summarizerSubmodule.name).to.equal(summarizerRtdProvider.CONSTANTS.SUBMODULE_NAME);
      expect(summarizerRtdProvider.summarizerSubmodule.init).to.be.a('function');
      expect(summarizerRtdProvider.summarizerSubmodule.getBidRequestData).to.be.a('function');
      expect(summarizerRtdProvider.summarizerSubmodule.getTargetingData).to.be.a('function');
    });
  });
});
