

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
- __options__: 
  - __useIndexInBulkUrl__ -  If set to 'false' /_bulk will be used /indexName/_bulk otherwise.
  - __httpOptions__ - general HTTP/HTTPS options for the [request](https://nodejs.org/api/https.html#https_https_request_options_callback), e.g. SSL key,cert,passphrase,ca,rejectUNauthorized etc. 

## Special fields for indexing

In general Elasticsearch > 2.3 (including Logsene) does not allow fields with leading underscore or dots in field names. Logsene-js converts such fields names (e.g. removing leading underscores, and replaces dots to underscores). However a few fields are interpreted for indexing before renaming the fields: 
- _type - used as '_type' in the index operation (bulk indexing)
- _id - used as '_id' in the index operation (bulk indexing)


## Environment variables
- LOGSENE_TMP_DIR - Directory to store failed bulk requests, for later re-transmission. Failed requests are not stored, when LOGSENE_TMP_DIR is not set.
- LOGSENE_LOG_INTERVAL - Time to collect logs before a bulk request is done. Default 10000 ms
- LOGSENE_BULK_SIZE - Maximum size of a bulk request. Default 1000.
- LOGSENE_MAX_MESSAGE_FIELD_SIZE - maximum size of the 'message' field, default 240k
- LOGSENE_URL - URL for the Logsene receiver. E.g. for On-Premise version. Defaults to Sematext Logsene SaaS receiver https://logsene-receiver.sematext.com/_bulk
- LOGSENE_BUFFER_ON_APP_LIMIT - default 'true'. HTTP bulk requests are repeated until Logsene accepts logs again. Please increase your daily limit setting in Logsene App settings, once you see "403, App limit reached" errors. Setting the value to 'false' will disable disk buffering only for failed http requests '403, Forbidden / App limit reached'. We recommend to keep the default setting 'true' to avoid any loss of logs. 
- LOGSENE_REMOVE_FIELDS - a comma separated list of fields, which should not be logged

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

- Please check [winston-logsene](https://github.com/sematext/winston-logsene) a transport layer for the winston logging framework.
- Please see [bunyan-logsene](https://github.com/6RiverSystems/bunyan-logsene) a transport layer for the bunyan logging framework.


