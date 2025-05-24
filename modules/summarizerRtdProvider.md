# Summarizer RTD Provider

This module uses Chrome's Summarizer API to enhance bid requests with content summaries and classifications for improved contextual targeting.

## Overview

The Summarizer RTD Provider leverages Chrome's AI-powered Summarizer API to analyze page content and provide:

1. Content summaries that can be used for contextual targeting
2. Content categories/topics that can be used for interest-based targeting
3. Ad server targeting parameters based on content classification

This can help improve the relevance of ads by ensuring they match the content of the page.

## Browser Support

This module requires Chrome browser version 119 or later with the Summarizer API enabled. The module will gracefully degrade when the API is not available.

## Configuration

### Basic Configuration

```javascript
pbjs.setConfig({
  realTimeData: {
    auctionDelay: 50,
    dataProviders: [
      {
        name: "summarizer",
        params: {
          enabled: true,
          timeout: 200 // milliseconds to wait for summary (default: 200)
        }
      }
    ]
  }
});
```

### Configuration Options

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| enabled | boolean | Enable/disable the module | - |
| timeout | number | Maximum time to wait for summary in milliseconds | 200 |
| targeting | boolean | Enable/disable ad server targeting | true |

## Data Usage

### OpenRTB Integration

The module adds the following data to the OpenRTB bid request:

1. `site.content.data` - Contains the content summary
2. `site.cat` - Contains content categories
3. `user.data` - Contains interest categories based on content

### Ad Server Targeting

The module provides the following targeting parameters:

1. `content_category` - The primary category of the page content

## Example Implementation

```html
<!-- Prebid.js -->
<script src="prebid.js"></script>
<script>
  var adUnits = [
    {
      code: 'div-1',
      mediaTypes: {
        banner: {
          sizes: [[300, 250]]
        }
      },
      bids: [
        {
          bidder: 'appnexus',
          params: {
            placementId: 13144370
          }
        }
      ]
    }
  ];

  pbjs.que.push(function() {
    pbjs.setConfig({
      realTimeData: {
        auctionDelay: 50,
        dataProviders: [
          {
            name: "summarizer",
            params: {
              enabled: true,
              timeout: 200
            }
          }
        ]
      }
    });
    
    pbjs.addAdUnits(adUnits);
    pbjs.requestBids();
  });
</script>
```

## Testing

You can test if the Summarizer API is available in your browser by running:

```javascript
if (navigator.summarizer && typeof navigator.summarizer.summarize === 'function') {
  console.log('Summarizer API is available');
} else {
  console.log('Summarizer API is not available');
}
```

## Further Reading

- [Chrome Summarizer API Documentation](https://developer.chrome.com/docs/ai/summarizer-api)
- [Chrome Status: Page Content Summarization](https://chromestatus.com/feature/5193953788559360)
