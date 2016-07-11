/*
 * @copyright Copyright (c) Sematext Group, Inc. - All Rights Reserved
 *
 * @licence SPM for NodeJS is free-to-use, proprietary software.
 * THIS IS PROPRIETARY SOURCE CODE OF Sematext Group, Inc. (Sematext)
 * This source code may not be copied, reverse engineered, or altered for any purpose.
 * This source code is to be used exclusively by users and customers of Sematext.
 * Please see the full license (found in LICENSE in this distribution) for details on its license and the licenses of its dependencies.
 */
'user strict'
var request = require('request')
var os = require('os')
var events = require('events')
var ipAddress = require('ip').address()
var util = require('util')
var path = require('path')
var stringifySafe = require('json-stringify-safe')
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
// settings for bulk requests
var MIN_LOGSENE_BULK_SIZE = 200
var MAX_LOGSENE_BULK_SIZE = 10000
var MAX_STORED_REQUESTS = Number(process.env.LOGSENE_MAX_STORED_REQUESTS) || 10000
var MAX_CLIENT_SOCKETS = Number(process.env.MAX_CLIENT_SOCKETS) || 10

// upper limit a user could set
var MAX_LOGSENE_BULK_SIZE_BYTES = 20 * 1024 * 1024
// lower limit a user could set
var MIN_LOGSENE_BULK_SIZE_BYTES = 1024 * 1024
var MAX_LOGSENE_BUFFER_SIZE = Number(process.env.LOGSENE_BULK_SIZE_BYTES) ||  1024 * 1024 // max 5 MB per http request   
// check limits set by users, and adjust if those would lead to problematic settings 
if (MAX_LOGSENE_BUFFER_SIZE > MAX_LOGSENE_BULK_SIZE_BYTES) {
  MAX_LOGSENE_BUFFER_SIZE = MAX_LOGSENE_BULK_SIZE_BYTES
}
if (MAX_LOGSENE_BUFFER_SIZE<MIN_LOGSENE_BULK_SIZE_BYTES) {
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
function Logsene (token, type, url, storageDirectory) {
  if (!token) {
    throw new Error('Logsene token not specified')
  }
  this.xLogseneOrigin = xLogseneOrigin
  this.token = token
  this.setUrl(url || process.env.LOGSENE_URL || process.env.LOGSENE_RECEIVER_URL || 'https://logsene-receiver.sematext.com/_bulk')
  this.type = type || 'logs'
  this.hostname = os.hostname()
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
  var tid = setInterval(function () {
    if (self.logCount > 0) {
      self.send()
    }
  }, process.env.LOGSENE_LOG_INTERVAL || 10000)
  if (tid.unref) {
    tid.unref()
  }
  process.on('exit', function () {
    self.send()
  })
  if (process.env.LOGSENE_TMP_DIR || storageDirectory) {
    this.diskBuffer(true, process.env.LOGSENE_TMP_DIR || storageDirectory)
  }
}
util.inherits(Logsene, events.EventEmitter)

Logsene.prototype.setUrl = function (url) {
  var tmpUrl = url
  if (url.indexOf ('_bulk') === -1) {
    tmpUrl = url + '/_bulk'
  } else {
    tmpUrl = url
  }
  this.url = tmpUrl.replace('_bulk', this.token + '/_bulk')
  var Agent = null
  if (/^https/.test(url)) {
    Agent = require('https').Agent
  } else {
    Agent = require('http').Agent
  }
  this.httpAgent = new Agent({maxSockets: MAX_CLIENT_SOCKETS})
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
  var type = fields ? fields._type : this.type
  if (fields && fields._type) {
    delete fields._type
  }
  var msg = {'@timestamp': new Date(), message: message, severity: level, host: this.hostname, ip: ipAddress}
  for (var x in fields) {
    // rename fields for Elasticsearch 2.x
    if (startsWithUnderscore.test(x) || hasDots.test(x)) {
      msg[x.replace(/\./g, '_').replace(/^_+/, '')] = fields[x]
    } else {
      msg[x] = fields[x]
    }
  }
  if (typeof msg['@timestamp'] === 'number') {
    msg['@timestamp'] = new Date(msg['@timestamp'])
  }
  this.emit('logged', {msg: msg})
  this.bulkReq.write(JSON.stringify({'index': {'_index': this.token, '_type': type || this.type}}) + '\n')
  this.bulkReq.write(stringifySafe(msg) + '\n')
  this.logCount++
  if (this.logCount === LOGSENE_BULK_SIZE || this.bulkReq.size()>MAX_LOGSENE_BUFFER_SIZE) {
    this.bulkReq.end()
    this.send()
  }
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
  var count = this.logCount
  this.logCount = 0
  var options = {
    url: this.url,
    logCount: count,
    headers: {
      'User-Agent': 'logsene-js',
      'Content-Type': 'application/json',
      'Connection': 'Close',
      'x-logsene-origin': this.xLogseneOrigin || xLogseneOrigin
    },
    body: this.bulkReq.getContents(),
    agent: self.httpAgent,
    method: 'POST'
  }
  this.bulkReq = null
  this.bulkReq = new streamBuffers.WritableStreamBuffer({
    initialSize: initialBufferSize,
    incrementAmount: incrementBuffer
  })
  if (options.body === false) {
    return
  }
  var req = request.post(options, function (err, res) {
    if (err || (res && res.statusCode > 399)) {
      self.emit('error', {source: 'logsene', err: (err || {message: 'Logsene status code:' + res.statusCode, httpStatus: res.statusCode, httpBody: res.body, url: options.url})})
      if (self.persistence) {
        options.agent = false
        options.body=options.body.toString()
        self.db.store(options, function () {
          delete options.body
        })
        return
      }
      req.destroy()
    } else {
      self.emit('log', {source: 'logsene', count: count})
      if (callback) {
        callback(null, res)
      }
      delete options.body
      req.destroy()
    }
  })
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
  options.agent = self.httpAgent
  var req = request.post(options, function (err, res) {
    if (cb) {
      cb(err, res)
    }
    if (err || (res && res.statusCode > 399)) {
      errObj = {source: 'logsene re-transmit', err: (err || {message: 'Logsene re-transmit status code:' + res.statusCode, httpStatus: res.statusCode, httpBody: res.body, url: options.url, fileName: name})}
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
