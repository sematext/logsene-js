

JavaScript client for [Sematext Logs](http://sematext.com/logsene).

# Installation

    npm install logsene-js --save

# Usage


    var Logsene = require('logsene-js')
    var logger =  new Logsene ('LOGS-APP-TOKEN')
    logger.log ('info', 'text message', {tags: ['a','b'], customField: 'custom-field'})

### Constructor Parameters

- __token__ - Logs App token. Sign up [here](https://apps.sematext.com/users-web/register.do).
- __type__ - Optional. Default type of your logs - please note you can define [Elasticsearch mapping templates in Sematext Logs](http://blog.sematext.com/elasticsearch-mapping-types-for-json-logging/)
- __url__ - Sematext Logs receiver URL (e.g. if you are shipping logs to [Sematext Enterprise](https://sematext.com/enterprise)), defaults to ```'https://logsene-receiver.sematext.com/_bulk'```
- __storageDirectory__ - Directory where to buffer logs in the case of failure
- __options__: 
  - __useIndexInBulkUrl__ -  If set to 'false' /_bulk will be used /indexName/_bulk otherwise.
  - __httpOptions__ - general HTTP/HTTPS options for the [request](https://nodejs.org/api/https.html#https_https_request_options_callback), e.g. SSL key,cert,passphrase,ca,rejectUNauthorized etc. 
  - __silent__ - If set to `true`, logsene-js will not log debug and errors to stdout. Used for prod envs, but not mandatory. This is `false` by default.

## Special fields for indexing

In general Elasticsearch > 2.3 (including Sematext Logs) does not allow fields with leading underscore or dots in field names. Logsene-js converts such fields names (e.g. removing leading underscores, and replaces dots to underscores). However, a few fields are interpreted for indexing before renaming the fields: 
- _type - used as '_type' in the index operation (bulk indexing)
- _id - used as '_id' in the index operation (bulk indexing)


## Environment variables
- LOGS_TMP_DIR - Directory to store failed bulk requests, for later re-transmission. Failed requests are not stored, when LOGS_TMP_DIR is not set.
- LOG_INTERVAL - Time to collect logs before a bulk request is done. Default 10000 ms
- LOGS_BULK_SIZE - Maximum size of a bulk request. Default 1000.
- LOGS_MAX_MESSAGE_FIELD_SIZE - maximum size of the 'message' field, default 240k
- LOGS_RECEIVER_URL - URL for the Sematext Logs receiver. E.g. for Sematext Enterprise version. Defaults to Sematext Logs SaaS receiver https://logsene-receiver.sematext.com/_bulk
- LOGSENE_TMP_DIR - Directory where to buffer logs if the Elasticsearch endpoint is unavailable. If this is not set, `logsene-js` will not buffer logs at all.
- LOGS_BUFFER_ON_APP_LIMIT - default 'true'. HTTP bulk requests are retried until Sematext starts accepting logs again. Please increase your daily limit setting in Logs App settings if you see "403, App limit reached" errors. Setting the value to 'false' will disable disk buffering only for failed http requests '403, Forbidden / App limit reached'. We recommend to keep the default setting 'true' to avoid any loss of logs. 
- LOGS_REMOVE_FIELDS - a comma separated list of fields, which should not be logged. For nested objects use a dot notation e.g. 'reques.body,request.size'

__Note:__ Previous versions of logsene-js used LOGSENE instead of LOGS prefix for the settings above. Logsene-js is backward compatible to previous environment variable names. However all variable names with the LOGSENE prefix are depracated and might be removed in future relases.

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
