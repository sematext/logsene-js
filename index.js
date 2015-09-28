/*
 * @copyright Copyright (c) Sematext Group, Inc. - All Rights Reserved
 *
 * @licence SPM for NodeJS is free-to-use, proprietary software.
 * THIS IS PROPRIETARY SOURCE CODE OF Sematext Group, Inc. (Sematext)
 * This source code may not be copied, reverse engineered, or altered for any purpose.
 * This source code is to be used exclusively by users and customers of Sematext.
 * Please see the full license (found in LICENSE in this distribution) for details on its license and the licenses of its dependencies.
 */

var MAX_LOGS = 999
var request = require('request')
var os = require('os')
var events = require('events')
var ipAddress = require('ip').address()
var util = require('util')
var path = require('path')

/**
 * token - the LOGSENE Token
 * type - type of log (string)
 * url - optional alternative URL for Logsene receiver (e.g. for on premises version)
 */
function Logsene (token, type, url) {
  if (token == null || token == '')
    throw new Error ('Logsene token not specified')
  this.url = (url || 'https://logsene-receiver.sematext.com/_bulk')
  this.token = token
  this.type = type
  this.hostname = os.hostname()
  this.bulkReq = ''
  this.logCount = 0
  this.sourceName = null
  if (process.mainModule && process.mainModule.filename)
    this.sourceName = path.basename(process.mainModule.filename)
  events.EventEmitter.call(this)
  var self = this
  var tid = setInterval(function () {
    if (self.logCount > 0)
      self.send()
  }, process.env.LOGSENE_LOG_INTERVAL || 10000)
  tid.unref()
  var self = this
  process.on ('exit', function () {
      self.send()
  })
}
util.inherits(Logsene, events.EventEmitter)

/**
 * Add log message to send buffer
 * @param level - log level e.g. 'info', 'warning', 'error'
 * @param message - text message
 * @param fields - Object with custom fields or overwrite of any other field e.g. e.g. "{@timestamp: new Date.toISOString()}"
 * @param callback (err, msg object)
 */
Logsene.prototype.log = function (level, message, fields, callback) {
  var msg = {'@timestamp': new Date().toISOString(), level: level, host: this.hostname, ip: ipAddress, message: message, '@source': this.sourceName}
  for (var x in fields) {
    msg[x] = fields[x]
  }
  var type = fields ? fields._type : this.type
  this.bulkReq += JSON.stringify({ 'index': {'_index': this.token, '_type': type || this.type}}) + '\n'
  this.bulkReq += JSON.stringify(msg) + '\n'
  this.logCount++
  if (this.logCount > MAX_LOGS) {
    this.send()
  }
  if (callback)
    callback(null, msg)
}

/**
 * Sending log entry  to LOGSENE - this function is triggered every 100 log message or 30 seconds.
 * @callback {function} optional callback function
 */
Logsene.prototype.send = function (callback) {
  var self = this
  var body = this.bulkReq
  var count = this.logCount
  this.bulkReq = ''
  this.logCount = 0
  var options = {
    url: this.url,
    headers: {
      'User-Agent': 'logsene-js',
      'Content-Type': 'application/json'
      // 'Keep-Alive': false
    },
    body: body,
    method: 'POST'
  }
  request.post(options,
    function (err, res) {
    if (err) {
      self.emit('error', {source: 'logsene', url: options.url, err: err, body: body})
    } else {
      self.emit('log', {source: 'logsene', url: options.url, request: body, count: count, response: res.body})
    }
    if (callback) {
      callback(err, res)
    }
  })
}

module.exports = Logsene
