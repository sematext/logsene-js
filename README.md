

JavaScript client for [Logsene](http://sematext.com/logsene/index.html).
Register for a [free account](https://apps.sematext.com/users-web/register.do) or Login to Logsene to create an App Token.

# Installation

    npm install logsene-js --save

# Usage


    var Logsene = require('logsene-js')
    var logger =  new Logsene ('LOGSENE-APP-TOKEN')
    logger.log ('info', 'text message', {tags: ['a','b'], customField: 'custom-field'})

### Constructor Parameters

- __token__ - Create your free account and access token [here](https://apps.sematext.com/users-web/register.do).
- __type__ - Optional. Default type of your logs - please note you can define [Elasticsearch mapping templates in Logsene](http://blog.sematext.com/2015/02/09/elasticsearch-mapping-types-for-json-logging/) 
- __url__ - Logsene receiver URL (e.g. for Logsene On Premises), defaults to ```'https://logsene-receiver.sematext.com/_bulk'```

## Environment variables
- LOGSENE_TMP_DIR - Directory to store failed bulk requests, for later re-transmission. Failed requests are not stored, when LOGSENE_TMP_DIR is not set.   
- LOGSENE_LOG_INTERVAL - Time to collect logs before a bulk request is done. Default 10000 ms
- LOGSENE_BULK_SIZE - Maximum size of a bulk request. Default 1000. 
- LOGSENE_URL - URL for the Logsene receiver. E.g. for On-Premise version. Defaults to Sematext Logsene SaaS receiver https://logsene-receiver.sematext.com/_bulk

## Security

- HTTPS is enabled by default 
- Environment variables for Proxy servers:
  - For HTTPS endpoints (default): HTTPS_PROXY / https_proxy
```
        export HTTPS_PROXY=https://my-ssl-proxy.example
        export HTTPS_PROXY=http://my-proxy.example
```
  - For HTTP endpoints (e.g. On-Premises): HTTP_PROXY / http_proxy
```
        export HTTP_PROXY=http://my-proxy.example
        export HTTP_PROXY=https://my-ssl-proxy.example
```

# Other related modules

Please check [winston-logsene](https://github.com/sematext/winston-logsene) a transport layer for the winston logging framework.


