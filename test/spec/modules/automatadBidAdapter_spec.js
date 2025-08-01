import { expect } from 'chai'
import { spec } from 'modules/automatadBidAdapter.js'
import { newBidder } from 'src/adapters/bidderFactory.js'

describe('automatadBidAdapter', function () {
  const adapter = newBidder(spec)

  const bidRequestRequiredParams = {
    bidder: 'automatad',
    params: {siteId: '123ad'},
    mediaTypes: {
      banner: {
        sizes: [[300, 600]],
      }
    },
    adUnitCode: 'some-ad-unit-code',
    transactionId: '1465569e-52cc-4c36-88a1-7174cfef4b44',
    sizes: [[300, 600]],
    bidId: '123abc',
    bidderRequestId: '3213887463c059',
    auctionId: 'abc-123',
    src: 'client',
    bidRequestsCount: 1
  }

  const bidRequestAllParams = {
    bidder: 'automatad',
    params: {siteId: '123ad', placementId: '123abc345'},
    mediaTypes: {
      banner: {
        sizes: [[300, 600]],
      }
    },
    adUnitCode: 'some-ad-unit-code',
    transactionId: '1465569e-52cc-4c36-88a1-7174cfef4b44',
    sizes: [[300, 600]],
    bidId: '123abc',
    bidderRequestId: '3213887463c059',
    auctionId: 'abc-123',
    src: 'client',
    bidRequestsCount: 1
  }

  const expectedResponse = [{
    'body': {
      'id': 'abc-123',
      'seatbid': [
        {
          'bid': [
            {
              'bidId': '123',
              'adm': '<!-- creative code -->',
              'adomain': [
                'someAdDomain'
              ],
              'crid': 123,
              'h': 600,
              'id': 'bid1',
              'impid': '1',
              'nurl': 'https://example/win',
              'price': 0.5,
              'w': 300
            }
          ]
        }
      ]
    }
  }]

  describe('codes', function () {
    it('should return a bidder code of automatad', function () {
      expect(spec.code).to.equal('automatad')
    })
    it('should alias atd', function () {
      expect(spec.aliases.length > 0 && spec.aliases[0] === 'atd').to.be.true
    })
  })

  describe('isBidRequestValid', function () {
    const inValidBid = Object.assign({}, bidRequestRequiredParams)
    delete inValidBid.params
    it('should return true if all params present', function () {
      expect(spec.isBidRequestValid(bidRequestAllParams)).to.equal(true)
    })

    it('should return true if only required params present', function() {
      expect(spec.isBidRequestValid(bidRequestRequiredParams)).to.equal(true)
    })

    it('should return false if any parameter missing', function () {
      expect(spec.isBidRequestValid(inValidBid)).to.be.false
    })
  })

  describe('buildRequests', function () {
    const req = spec.buildRequests([ bidRequestRequiredParams ], { refererInfo: { } })
    let rdata

    it('should have withCredentials option as true', function() {
      expect(req.options.withCredentials).to.equal(true)
    })

    it('should return request object', function () {
      expect(req).to.not.be.null
    })

    it('should build request data', function () {
      expect(req.data).to.not.be.null
    })

    it('should include one request', function () {
      rdata = JSON.parse(req.data)
      expect(rdata.imp.length).to.equal(1)
    })

    it('should include siteId', function () {
      const r = rdata.imp[0]
      expect(r.siteId !== null).to.be.true
    })

    it('should include media types', function () {
      const r = rdata.imp[0]
      expect(r.media_types !== null).to.be.true
    })

    it('should include adunit code', function () {
      const r = rdata.imp[0]
      expect(r.adUnitCode !== null).to.be.true
    })
  })

  describe('interpretResponse', function () {
    it('should get the correct bid response', function () {
      const result = spec.interpretResponse(expectedResponse[0])
      expect(result).to.be.an('array').that.is.not.empty
      expect(result[0].meta.advertiserDomains[0]).to.equal('someAdDomain');
    })

    it('should interpret multiple bids in seatbid', function () {
      const multipleBidResponse = [{
        'body': {
          'id': 'abc-321',
          'seatbid': [
            {
              'bid': [
                {
                  'adm': '<!-- creative code -->',
                  'adomain': [
                    'someAdDomain'
                  ],
                  'crid': 123,
                  'h': 600,
                  'id': 'bid1',
                  'impid': 'imp1',
                  'nurl': 'https://example/win',
                  'price': 0.5,
                  'w': 300
                }
              ]
            }, {
              'bid': [
                {
                  'adm': '<!-- creative code -->',
                  'adomain': [
                    'someAdDomain'
                  ],
                  'crid': 321,
                  'h': 600,
                  'id': 'bid1',
                  'impid': 'imp2',
                  'nurl': 'https://example/win',
                  'price': 0.5,
                  'w': 300
                }
              ]
            }
          ]
        }
      }]
      const result = spec.interpretResponse(multipleBidResponse[0]).map(bid => {
        const {requestId} = bid;
        return [ requestId ];
      });

      assert.equal(result.length, 2);
      assert.deepEqual(result, [[ 'imp1' ], [ 'imp2' ]]);
    })

    it('handles empty bid response', function () {
      const response = {
        body: ''
      }
      const result = spec.interpretResponse(response)
      expect(result.length).to.equal(0)
    })
  })

  describe('onTimeout', function () {
    const timeoutData = {
      'bidId': '123',
      'bidder': 'automatad',
      'adUnitCode': 'div-13',
      'auctionId': '1232',
      'params': [
        {
          'siteId': 'test',
          'placementId': 'test123'
        }
      ],
      'timeout': 1000
    }

    it('should exists and be a function', function () {
      expect(spec.onTimeout).to.exist.and.to.be.a('function');
    });

    it('should include timeoutData', function () {
      expect(spec.onTimeout(timeoutData)).to.be.undefined;
    })
  });

  describe('onBidWon', function () {
    const serverResponses = spec.interpretResponse(expectedResponse[0])
    const wonbid = serverResponses[0]
    let ajaxStub

    beforeEach(() => {
      ajaxStub = sinon.stub(spec, 'ajaxCall')
    })

    afterEach(() => {
      ajaxStub.restore()
    })

    it('Returns true is nurl is good/not blank', function () {
      expect(wonbid.nurl).to.not.equal('')
      expect(spec.onBidWon(wonbid)).to.be.true
      expect(ajaxStub.calledOnce).to.equal(true)
      expect(ajaxStub.firstCall.args[0].indexOf('https://')).to.equal(0)
    })
  })
})
