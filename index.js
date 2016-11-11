/*
 * @copyright Copyright (c) Sematext Group, Inc. - All Rights Reserved
 *
 * @licence logsene-js is free-to-use, proprietary software.
 * THIS IS PROPRIETARY SOURCE CODE OF Sematext Group, Inc. (Sematext)
 * This source code may not be copied, reverse engineered, or altered for any purpose.
 * This source code is to be used exclusively by users and customers of Sematext.
 * Please see the full license (found in LICENSE in this distribution) for details on its license and the licenses of its dependencies.
 */
'user strict'
var Requester = require('request')
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
var startsWithUnderscore = /^_/
var hasDots = /\./g
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
var MAX_CLIENT_SOCKETS = Number(process.env.MAX_CLIENT_SOCKETS) || 2

// upper limit a user could set
var MAX_LOGSENE_BULK_SIZE_BYTES = 20 * 1024 * 1024
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
var LOGSENE_BULK_SIZE = Number(process.env.LOGSENE_BULK_SIZE) || 1000 // max 1000 messages per bulk req.
if (LOGSENE_BULK_SIZE > MAX_LOGSENE_BULK_SIZE) {
  LOGSENE_BULK_SIZE = MAX_LOGSENE_BULK_SIZE
}
if (LOGSENE_BULK_SIZE < MIN_LOGSENE_BULK_SIZE) {
  LOGSENE_BULK_SIZE = MIN_LOGSENE_BULK_SIZE
}

/**
 * token - the LOGSENE Token
 * type - type of log (string)
 * url - optional alternative URL for Logsene receiver (e.g. for on premises version)
 */
function Logsene (token, type, url, storageDirectory, options) {
  if (!token) {
    throw new Error('Logsene token not specified')
  }
  if (options) {
    this.options = options
  } else {
    this.options = {
      useIndexInBulkUrl: false
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
  this.setUrl(url || process.env.LOGSENE_URL || process.env.LOGSENE_RECEIVER_URL || 'https://logsene-receiver.sematext.com/_bulk')
  this.type = type || 'logs'
  this.hostname = process.env.SPM_REPORTED_HOSTNAME || os.hostname()
  this.bulkReq = new streamBuffers.WritableStreamBuffer({
    initialSize: initialBufferSize,
    incrementAmount: incrementBuffer
  })
  this.offset
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
  var httpOptions = {maxSockets: MAX_CLIENT_SOCKETS, keepAlive: true, maxFreeSockets: MAX_CLIENT_SOCKETS}
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
      maxStoredRequests: MAX_STORED_REQUESTS,
      interval: process.env.LOGSENE_DISK_BUFFER_INTERVAL || 60000
    })
    this.db.syncFileListFromDir()
    var self = this
    if (!this.db.isCached) {
      // only the first instance registers for retransmit-req
      // to avoid double event handling from multiple instances
      this.db.on('retransmit-req', function (event) {
        self.shipFile(event.fileName, event.buffer, function (err, res) {
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
  var type = fields ? fields._type : this.type

  var elasticsearchDocId = null
  if (fields && fields._type) {
    delete fields._type
  }
  if (fields && fields._id) {
    elasticsearchDocId = fields._id
  }
  var msg = {'@timestamp': new Date(), message: message, severity: level, host: this.hostname, ip: ipAddress}
  for (var x in fields) {
    // rename fields for Elasticsearch 2.x
    if (startsWithUnderscore.test(x) || hasDots.test(x)) {
      msg[x.replace(/\./g, '_').replace(/^_+/, '')] = fields[x]
    } else {
      if (! (typeof fields[x] === 'function')) {
        msg[x] = fields[x]
      }
    }
  }
  if (typeof msg['@timestamp'] === 'number') {
    msg['@timestamp'] = new Date(msg['@timestamp'])
  }
  var _index = this.token
  if (fields && typeof (fields._index) === 'function') {
    _index = fields._index(msg)
  }
  if (msg.message && Buffer.byteLength(msg.message, 'utf8') > this.maxMessageFieldSize) {
    var cutMsg = new Buffer(this.maxMessageFieldSize)
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
    this.bulkReq.write(stringifySafe({'index': {'_index': _index, '_id': String(elasticsearchDocId), '_type': type || this.type}}) + '\n')
  } else {
    this.bulkReq.write(stringifySafe({'index': {'_index': _index, '_type': type || this.type}}) + '\n')
  }
  this.bulkReq.write(stringifySafe(msg) + '\n')

  if (this.logCount === LOGSENE_BULK_SIZE || this.bulkReq.size() > MAX_LOGSENE_BUFFER_SIZE) {
    this.send()
  }
  this.emit('logged', {msg: msg, _index: _index})
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
    if (err || (res && res.statusCode > 399)) {
      if (err && (err.code || err.message)) {
        err.url = options.url
      }
      self.emit('error', {source: 'logsene-js', err: (err || {message: 'HTTP status code:' + res.statusCode, httpStatus: res.statusCode, httpBody: res.body, url: options.url})})
      if (self.persistence) {
        if (req) {
          req.destroy()
        }
        options.body = options.body.toString()
        self.db.store(options, function () {
          delete options.body
        })
        return
      }
    } else {
      self.emit('log', {source: 'logsene-js', count: count, url: options.url})
      delete options.body
      if (req) {
        req.destroy()
      }
      if (callback) {
        callback(null, res)
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
      var errObj = {source: 'logsene re-transmit', err: (err || {message: 'Logsene re-transmit status code:' + res.statusCode, httpStatus: res.statusCode, httpBody: res.body, url: options.url, fileName: name})}
      self.emit('error', errObj)
      if (cb) {
        cb(errObj)
      }
    } else {
      if (cb) {
        cb(null, {file: name, count: options.logCount})
      }
      self.emit('file shipped', {file: name, count: options.logCount})
      self.emit('rt', {count: options.logCount, source: 'logsene', file: name, url: String(options.url), request: null, response: null})
    }
    req.destroy()
  })
}

module.exports = Logsene
