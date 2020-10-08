/*
 * See the NOTICE.txt file distributed with this work for additional information
 * regarding copyright ownership.
 * Sematext licenses logsene-js to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
'user strict'
var Requester = require('request')
var fs = require('fs')
var util = require('util')
var os = require('os')
var events = require('events')
var ipAddress = require('ip').address()
var path = require('path')
var stringifySafe = require('fast-safe-stringify')
var streamBuffers = require('stream-buffers')

// settings for node stream buffer
var initialBufferSize = 1024 * 1024
var incrementBuffer = 1024 * 1024
// re-usable regular expressions
var limitRegex = /limit/i
var appNotFoundRegEx = /Application not found for token/i
var disableJsonEnrichment = (process.env.ENABLE_JSON_ENRICHMENT === 'false')
var replaceDotsInFieldNames = true
if (process.env.REPLACE_DOTS_IN_FIELD_NAMES === 'false' || process.env.REPLACE_DOTS_IN_FIELD_NAMES === '0') {
  replaceDotsInFieldNames = false
}
// load ENV like Logsene receivers from file containing
// env vars e.g. SPM_RECEIVER_URL, EVENTS_RECEIVER_URL, LOGSENE_RECEIVER_URL
// the file overwrites the actual environment
// and is used by Sematext Enterprise or multi-region setups to
// setup receiver URLs
function loadEnvFromFile (fileName) {
  try {
    var receivers = fs.readFileSync(fileName).toString()
    if (receivers) {
      var lines = receivers.split('\n')
    }
    if (/logsene-js/.test(process.env.DEBUG)) {
      console.log(new Date(), 'loading Sematext receiver URLs from ' + fileName)
    }
    lines.forEach(function (line) {
      var kv = line.split('=')
      if (kv.length === 2 && kv[1].length > 0) {
        process.env[kv[0].trim()] = kv[1].trim()
        if (/logsene-js/.test(process.env.DEBUG)) {
          console.log(kv[0].trim() + ' = ' + kv[1].trim())
        }
      }
    })
  } catch (error) {
    // ignore missing file or wrong format
    if (/logsene-js/.test(process.env.DEBUG)) {
      console.error(error.message)
    }
  }
}
var envFileName = '/etc/sematext/receivers.config'
/**
  if (/win/.test(os.platform()) {
    envFileName = process.env.ProgramData + '\\Sematext\\receivers.config'
  }
**/
loadEnvFromFile(envFileName)

// removing LOGSENE from ENV variable names
// and be backward compatible in case users still use old ENV variable names
var envVarMapping = [
  ['LOGSENE_MAX_MESSAGE_FIELD_SIZE', 'LOGS_MAX_MESSAGE_FIELD_SIZE'],
  ['LOGSENE_MAX_STORED_REQUESTS', 'LOGS_MAX_STORED_REQUESTS'],
  ['LOGSENE_BULK_SIZE_BYTES', 'LOGS_BULK_SIZE_BYTES'],
  ['LOGSENE_BULK_SIZE', 'LOGS_BULK_SIZE'],
  ['LOGSENE_LOG_INTERVAL', 'LOG_INTERVAL'],
  ['LOGSENE_DISK_BUFFER_INTERVAL', 'LOGS_DISK_BUFFER_INTERVAL'],
  ['LOGSENE_RECEIVER_URL', 'LOGS_RECEIVER_URL'],
  ['SPM_RECEIVER_URL', 'MONITORING_RECEIVER_URL'],
  ['SPM_TOKEN', 'MONITORING_TOKEN'],
  ['LOGSENE_REMOVE_FIELDS', 'REMOVE_FIELDS'],
  ['LOGSENE_TMP_DIR', 'LOGS_TMP_DIR'],
  ['LOGSENE_BUFFER_ON_APP_LIMIT ', 'LOGS_BUFFER_ON_APP_LIMIT'],
  ['LOGSENE_REMOVE_FIELDS', 'LOGS_REMOVE_FIELDS'],
  ['LOGSENE_REMOVE_FIELDS', 'REMOVE_FIELDS'],
  ['SPM_REPORTED_HOSTNAME', 'REPORTED_HOSTNAME']
]

function mapEnv (item) {
  if ((!process.env[item[0]]) && (process.env[item[1]] !== undefined)) {
    process.env[item[0]] = process.env[item[1]]
    if (/logsene-js/.test(process.env.DEBUG)) {
      console.log('Set ', item[0], ' to ', process.env[item[0]], ' from ', item[1])
    }
  }
}
envVarMapping.forEach(mapEnv)

// SPM_REPORTED_HOSTNAME might be set by Sematext Docker Agent
// the container hostname might not be helpful ...
// this might be removed after next release of SDA setting xLogseneOrigin from SDA
var xLogseneOrigin = process.env.SPM_REPORTED_HOSTNAME || os.hostname()
// limit message size
var MAX_MESSAGE_FIELD_SIZE = Number(process.env.LOGSENE_MAX_MESSAGE_FIELD_SIZE) || 1024 * 240 // 240 K, leave
// settings for bulk requests
var MIN_LOGSENE_BULK_SIZE = 200
var MAX_LOGSENE_BULK_SIZE = 10000
var MAX_STORED_REQUESTS = Number(process.env.LOGSENE_MAX_STORED_REQUESTS) || 10000
var MAX_CLIENT_SOCKETS = Number(process.env.MAX_CLIENT_SOCKETS) || 5

// upper limit a user could set - 10 MB as configured in Sematext Cloud receivers
var MAX_LOGSENE_BULK_SIZE_BYTES = 10 * 1000 * 1000
// lower limit a user could set
var MIN_LOGSENE_BULK_SIZE_BYTES = 1024 * 1024
var MAX_LOGSENE_BUFFER_SIZE = Number(process.env.LOGSENE_BULK_SIZE_BYTES) || 1024 * 1024 * 3 // max 3 MB per http request
// check limits set by users, and adjust if those would lead to problematic settings
if (MAX_LOGSENE_BUFFER_SIZE > MAX_LOGSENE_BULK_SIZE_BYTES) {
  MAX_LOGSENE_BUFFER_SIZE = MAX_LOGSENE_BULK_SIZE_BYTES
}
if (MAX_LOGSENE_BUFFER_SIZE < MIN_LOGSENE_BULK_SIZE_BYTES) {
  MAX_LOGSENE_BUFFER_SIZE = MIN_LOGSENE_BULK_SIZE_BYTES
}
var LOGSENE_BULK_SIZE = Number(process.env.LOGSENE_BULK_SIZE) || 500 // max 500 messages per bulk req.
if (LOGSENE_BULK_SIZE > MAX_LOGSENE_BULK_SIZE) {
  LOGSENE_BULK_SIZE = MAX_LOGSENE_BULK_SIZE
}
if (LOGSENE_BULK_SIZE < MIN_LOGSENE_BULK_SIZE) {
  LOGSENE_BULK_SIZE = MIN_LOGSENE_BULK_SIZE
}

const deleteKey = require('del-key')

function removeFields (fieldList, doc) {
  if (fieldList && fieldList.length > 0 && fieldList[0] !== '') {
    for (var i = fieldList.length; i >= 0; --i) {
      deleteKey(doc, fieldList[i])
    }
  }
  return doc
}

// Create a deep clone of an object while allowing caller to rename
// keys, replace values, or reject key-pairs entirely.
//
// Does not modify the source object. Callback receives (key, value)
// and is expected to return a two-item array [newKey, newValue], or
// null if the pair should be absent from the resulting object.

function deepConvert (src, cb) {
  var dest
  if (Array.isArray(src)) {
    dest = []
  } else {
    dest = {}
  }
  if (dest) {
    for (var key in src) {
      if (src.hasOwnProperty(key)) {
        var val = src[key]
        var newKV = cb(key, val)
        if (newKV === null) {
          // skip this field entirely
          continue
        }

        var newKey = newKV[0]
        var newVal = newKV[1]

        if (newVal !== undefined &&
          newVal !== null &&
          (Array.isArray(newVal) || newVal.constructor === Object)) {
          dest[newKey] = deepConvert(newVal, cb)
        } else {
          dest[newKey] = newVal
        }
      }
    }
  } else {
    dest = src
  }

  return dest
}

/**
 * token - the LOGSENE Token
 * type - type of log (string)
 * url - optional alternative URL for Logsene receiver (e.g. for on premises version)
 * storageDirectory - directory where to buffer logs
 * options - @object { useIndexInBulkUrl, httpOptions, silent }
 */
function Logsene (token, type, url, storageDirectory, options) {
  if (!token) {
    throw new Error('Logsene token not specified')
  }
  if (options) {
    this.options = options
  } else {
    this.options = {
      useIndexInBulkUrl: false,
      silent: false
    }
  }
  if (url && /logsene/.test(url)) {
    // logs to logsene should use /TOKEN/_bulk
    this.options.useIndexInBulkUrl = true
  }
  this.request = null
  this.maxMessageFieldSize = MAX_MESSAGE_FIELD_SIZE
  this.xLogseneOrigin = xLogseneOrigin
  this.token = token
  this.setUrl(url || process.env.LOGSENE_URL || process.env.LOGSENE_RECEIVER_URL || process.env.LOGS_URL || 'https://logsene-receiver.sematext.com/_bulk')
  this.type = type || 'logs'
  this.hostname = process.env.SPM_REPORTED_HOSTNAME || os.hostname()
  this.bulkReq = new streamBuffers.WritableStreamBuffer({
    initialSize: initialBufferSize,
    incrementAmount: incrementBuffer
  })
  this.logCount = 0
  this.sourceName = null
  if (process.mainModule && process.mainModule.filename) {
    this.sourceName = path.basename(process.mainModule.filename)
  }
  events.EventEmitter.call(this)
  var self = this
  self.lastSend = Date.now()
  var logInterval = Number(process.env.LOGSENE_LOG_INTERVAL) || 20000
  var tid = setInterval(function () {
    if (self.logCount > 0 && (Date.now() - self.lastSend) > (logInterval - 1000)) {
      self.send()
    }
  }, logInterval)
  if (tid.unref) {
    tid.unref()
  }
  process.on('beforeExit', function () {
    self.send()
  })
  if (process.env.LOGSENE_TMP_DIR || storageDirectory) {
    this.diskBuffer(true, process.env.LOGSENE_TMP_DIR || storageDirectory)
  }
  var fieldListStr = process.env.LOGSENE_REMOVE_FIELDS || process.env.REMOVE_FIELDS || ''
  this.removeFieldsList = fieldListStr.replace(/ /g, '').split(',')

  // error handling
  self.on('x-logsene-error', function (errObj) {
    if (!self.options.silent) {
      console.error(
        new Date().toISOString() + 
        ` logsene-js: cannot reach the receiver URL: ${errObj.err.url}, please check the error message ...`,
        errObj
      )
    }
  })
}
util.inherits(Logsene, events.EventEmitter)

Logsene.prototype.setUrl = function (url) {
  var tmpUrl = url
  if (url.indexOf('_bulk') === -1) {
    tmpUrl = url + '/_bulk'
  } else {
    tmpUrl = url
  }
  if (this.options && this.options.useIndexInBulkUrl) {
    this.url = tmpUrl.replace('_bulk', this.token + '/_bulk')
  } else {
    this.url = tmpUrl
  }
  var Agent = null
  var httpOptions = { maxSockets: MAX_CLIENT_SOCKETS, keepAlive: false, maxFreeSockets: MAX_CLIENT_SOCKETS }
  if (this.options.httpOptions) {
    var keys = Object.keys(this.options.httpOptions)
    for (var i = 0; i < keys.length; i++) {
      httpOptions[keys[i]] = this.options.httpOptions[keys[i]]
    }
  }
  if (/^https/.test(url)) {
    Agent = require('https').Agent
  } else {
    Agent = require('http').Agent
  }
  this.httpAgent = new Agent(httpOptions)
  this.request = Requester.defaults({
    agent: this.httpAgent,
    timeout: 60000
  })
}
var DiskBuffer = require('./DiskBuffer.js')

Logsene.prototype.diskBuffer = function (enabled, dir) {
  if (enabled) {
    var tmpDir = path.join((dir || require('os').tmpdir()), this.token)
    this.db = DiskBuffer.createDiskBuffer({
      tmpDir: tmpDir,
      maxStoredRequests: Number(MAX_STORED_REQUESTS),
      interval: process.env.LOGSENE_DISK_BUFFER_INTERVAL || 5000
    })
    this.db.syncFileListFromDir()
    var self = this
    if (!this.db.isCached) {
      // only the first instance registers for retransmit-req
      // to avoid double event handling from multiple instances
      this.db.on('retransmit-req', function (event) {
        self.shipFile(event.fileName, event.buffer, function (err, res) {
          if (err && err.httpBody && appNotFoundRegEx.test(err.httpBody)) {
            // remove file from DiskBuffer when token is invalid
            self.db.rmFile.call(self.db, event.fileName)
            self.db.retransmitNext.call(self.db)
            return
          }
          if (!err && res) {
            self.db.rmFile.call(self.db, event.fileName)
            self.db.retransmitNext.call(self.db)
          } else {
            self.db.unlock.call(self.db, event.fileName)
          }
        })
      })
    }
  }
  this.persistence = enabled
}

/**
 * Add log message to send buffer
 * @param level - log level e.g. 'info', 'warning', 'error'
 * @param message - text message
 * @param fields - Object with custom fields or overwrite of any other field e.g. e.g. "{@timestamp: new Date.toISOString()}"
 * @param callback (err, msg object)
 */
Logsene.prototype.log = function (level, message, fields, callback) {
  this.logCount = this.logCount + 1
  let type = 'logs'
  let logType = 'logs'

  if (fields) {
    logType = fields._type
  }

  if (this.options.useIndexInBulkUrl) {
    // not a Sematext service -> use only one type per index
    // Elasticsearch > 6.x allows only one type per index
    type = this.type
  }

  var msg = {
    '@timestamp': new Date(),
    severity: level,
    message,
    logType,
    os: {
      host: this.hostname,
      hostip: ipAddress
    }
  }

  var elasticsearchDocId = null
  if (fields && fields._type) {
    delete fields._type
  }
  if (fields && fields._id) {
    elasticsearchDocId = fields._id
  }

  if (disableJsonEnrichment) {
    msg = {}
  }
  var esSanitizedFields = deepConvert(fields, function (key, val) {
    if (typeof val === 'function') {
      return null
    } else {
      if (replaceDotsInFieldNames) {
        return [key.replace(/\./g, '_').replace(/^_+/, ''), val]
      } else {
        // remove leading _
        return [key.replace(/^_+/, ''), val]
      }
    }
  })
  msg = Object.assign(msg, esSanitizedFields)
  if (msg['@timestamp'] && typeof msg['@timestamp'] === 'number') {
    msg['@timestamp'] = new Date(msg['@timestamp'])
  }
  msg = removeFields(this.removeFieldsList, msg)
  var _index = this.token
  if (fields && typeof (fields._index) === 'function') {
    _index = fields._index(msg)
  } else {
    if (fields && fields._index != undefined) {
      _index = fields._index
      delete msg.index
    }
  }

  if (msg.message && typeof msg.message === 'string' && Buffer.byteLength(msg.message, 'utf8') > this.maxMessageFieldSize) {
    // new nodejs api, let's use Buffer.alloc instead of Buffer(size)
    var cutMsg = Buffer.alloc ? Buffer.alloc(this.maxMessageFieldSize) : new Buffer(this.maxMessageFieldSize)
    cutMsg.write(msg.message)
    msg.message = cutMsg.toString()
    if (msg.originalLine) {
      // when message is too large and logagent added originalLine,
      // this should be removed to stay under the limits in receiver
      delete msg.originalLine
    }
    msg.logsene_client_warning = 'Warning: message field too large > ' + this.maxMessageFieldSize + ' bytes'
  }

  if (elasticsearchDocId !== null) {
    this.bulkReq.write(stringifySafe({ 'index': { '_index': _index, '_id': String(elasticsearchDocId), '_type': type || this.type } }) + '\n')
  } else {
    this.bulkReq.write(stringifySafe({ 'index': { '_index': _index, '_type': type || this.type } }) + '\n')
  }

  this.bulkReq.write(stringifySafe(msg) + '\n')

  if (this.logCount === LOGSENE_BULK_SIZE || this.bulkReq.size() > MAX_LOGSENE_BUFFER_SIZE) {
    this.send()
  }
  this.emit('logged', { msg: msg, _index: _index })
  if (callback) {
    callback(null, msg)
  }
}

/**
 * Sending log entry  to LOGSENE - this function is triggered every 100 log message or 30 seconds.
 * @callback {function} optional callback function
 */
Logsene.prototype.send = function (callback) {
  var self = this
  var buffer = this.bulkReq
  this.bulkReq = new streamBuffers.WritableStreamBuffer({
    initialSize: initialBufferSize,
    incrementAmount: incrementBuffer
  })
  buffer.end()
  self.lastSend = Date.now()
  var count = this.logCount
  var options = {
    url: this.url,
    logCount: count,
    headers: {
      'User-Agent': 'logsene-js',
      'Content-Type': 'application/json',
      'Connection': 'Close',
      'x-logsene-origin': this.xLogseneOrigin || xLogseneOrigin
    },
    body: buffer.getContents(),
    method: 'POST'
  }

  if (options.body === false) {
    return
  }
  var req = null
  function httpResult (err, res) {
    // if (res && res.body) console.log(res.statusCode, res.body)
    var logseneError = null
    if (res && res.headers && res.headers['x-logsene-error']) {
      logseneError = res.headers['x-logsene-error']
    }
    var errorMessage = null
    var errObj = null
    if (err || (res && res.statusCode > 399) || logseneError) {
      if (err && (err.code || err.message)) {
        err.url = options.url
      }
      if (res && res.statusCode) {
        errorMessage = 'HTTP status code:' + res.statusCode
      }

      if (logseneError) {
        errorMessage += ', ' + logseneError
      }
      errObj = { source: 'logsene-js', err: (err || { message: errorMessage, httpStatus: res.statusCode, httpBody: res.body, url: options.url }) }
      self.emit('x-logsene-error', errObj)

      if (self.persistence) {
        if (req) {
          req.destroy()
        }
        var storeFileFlag = true
        // don't use disk buffer for invalid Logsene tokens
        if (res && res.body && appNotFoundRegEx.test(res.body)) {
          storeFileFlag = false
        }
        if (res && res.statusCode && res.statusCode === 400) {
          storeFileFlag = false
        }
        if (logseneError && limitRegex.test(logseneError)) {
          // && process.env.LOGSENE_BUFFER_ON_APP_LIMIT === 'false'
          storeFileFlag = false
        }
        if (storeFileFlag) {
          options.body = options.body.toString()
          self.db.store(options, function () {
            delete options.body
          })
        } else {
          self.emit('fileNotStored', options)
        }
      }
    } else {
      try {
        res.body = JSON.parse(res.body)
      } catch (error) {
        err = error
      }

      if (err) {
        errObj = { source: 'logsene-js', err: err }
        self.emit('x-logsene-error', errObj)

        if (self.persistence && req && req.destroy) {
          req.destroy()
        }
      } else {
        res.body.items.forEach(function (item) {
          var result = item.index || item.create || item.update || item.delete
          if (result && result.status > 399) {
            errorMessage = 'HTTP status code:' + result.status + ' Error: ' + JSON.stringify(result.error)
            var errObj = {
              source: 'logsene-js',
              err: { message: errorMessage, httpStatus: result.status, httpBody: result, url: options.url }
            }
            self.emit('x-logsene-error', errObj)
          }
        })

        self.emit('log', { source: 'logsene-js', count: count, url: options.url })
        delete options.body
        if (req && req.destroy) {
          req.destroy()
        }
        if (callback) {
          callback(errObj, res)
        }
      }
    }
  }
  self.logCount = Math.max(self.logCount - count, 0)
  req = self.request.post(options, httpResult)
}

Logsene.prototype.shipFile = function (name, data, cb) {
  var self = this
  var options = null
  try {
    options = JSON.parse(data)
  } catch (err) {
    // wrong file format
  }
  if (options == null || options.options) {
    // wrong file format?
    // cleanup from earlier versions
    // self.db.rmFile(name)
    return cb(new Error('wrong bulk file format'))
  }
  options.body = options.body.toString()
  options.url = self.url
  var req = self.request.post(options, function (err, res) {
    if (err || (res && res.statusCode > 399)) {
      var errObj = { source: 'logsene re-transmit', err: (err || { message: 'Logsene re-transmit status code:' + res.statusCode, httpStatus: res.statusCode, httpBody: res.body, url: options.url, fileName: name }) }
      self.emit('x-logsene-error', errObj)

      if (cb) {
        cb(errObj)
      }
    } else {
      if (cb) {
        cb(null, { file: name, count: options.logCount })
      }
      self.emit('file shipped', { file: name, count: options.logCount })
      self.emit('rt', { count: options.logCount, source: 'logsene', file: name, url: String(options.url), request: null, response: null })
    }
    if (req && req.destroy) {
      req.destroy()
    }
  })
}
module.exports = Logsene
