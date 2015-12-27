/*
 * @copyright Copyright (c) Sematext Group, Inc. - All Rights Reserved
 *
 * @licence SPM for NodeJS is free-to-use, proprietary software.
 * THIS IS PROPRIETARY SOURCE CODE OF Sematext Group, Inc. (Sematext)
 * This source code may not be copied, reverse engineered, or altered for any purpose.
 * This source code is to be used exclusively by users and customers of Sematext.
 * Please see the full license (found in LICENSE in this distribution) for details on its license and the licenses of its dependencies.
 */

var MAX_LOGS = process.env.LOGSENE_BULK_SIZE || 999
var request = require('request')
var os = require('os')
var events = require('events')
var ipAddress = require('ip').address()
var util = require('util')
var path = require('path')
var fs = require('fs')

/**
 * token - the LOGSENE Token
 * type - type of log (string)
 * url - optional alternative URL for Logsene receiver (e.g. for on premises version)
 */
function Logsene (token, type, url) {
  if (token === null || token === '') {
    throw new Error('Logsene token not specified')
  }
  this.url = (url || 'https://logsene-receiver.sematext.com/_bulk')
  this.token = token
  this.type = type
  this.hostname = os.hostname()
  this.bulkReq = ''
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
  tid.unref()
  process.on('exit', function () {
    self.send()
  })
}
util.inherits(Logsene, events.EventEmitter)

Logsene.prototype.setUrl = function (url) {
  this.url = url
}

Logsene.prototype.diskBuffer = function (enabled, dir) {
  this.tmpDir = (dir || require('os').tmpdir())
  this.persistence = enabled
  var self = this
  if (enabled === true) {
    this.tid = setInterval(function () {
      self.retransmit()
    }, 20000)
    this.on('file shipped', function (data) {
      fs.unlink(data.file, function (err) {
        if (err) {
          console.error('logsene-js: error removing file ' + name)
        } else {
          console.log ('removed file ' + data.file)
        }
      })
    })
  } else {
    clearInterval(this.tid)
  }
}
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
  this.bulkReq += JSON.stringify({'index': {'_index': this.token, '_type': type || this.type}}) + '\n'
  this.bulkReq += JSON.stringify(msg) + '\n'
  this.logCount++
  if (this.logCount > MAX_LOGS) {
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
        if (self.persistence) {
          console.log('storing file')
          self.store({options: options})
        }
      } else {
        self.emit('log', {source: 'logsene', url: options.url, request: body, count: count, response: res.body})
      }
      if (callback) {
        callback(err, res)
      }
    })
}

Logsene.prototype.getFileName = function () {
  return path.join(this.tmpDir,  new Date().getTime() + '.bulk')
}

Logsene.prototype.store = function (data, cb) {
  var fn = this.getFileName()
  console.log('storing file ' + fn)
  fs.writeFile(fn, JSON.stringify(data), function (err) {
    if (err && cb) {
      cb(err)
    }
  })
}

function walk (currentDirPath, callback) {
  var fs = require('fs')
  var path = require('path')
  fs.readdirSync(currentDirPath).forEach(function (name) {
    var filePath = path.join(currentDirPath, name)
    var stat = fs.statSync(filePath)
    if (stat.isFile()) {
      callback(filePath, stat)
    } else if (stat.isDirectory()) {
      walk(filePath, callback)
    }
  })
}

Logsene.prototype.shipFile = function (name, cb) {
  var self = this
  fs.readFile(name, function (err, data) {
    try {
      if (err && cb) {
        cb(err)
      }
      var options = JSON.parse(data)
      console.log(data)
      options.url = self.url
      request.post(options, function (err, res) {
        if (err) {
          self.emit('error', {source: 'logsene', url: options.url, err: err, body: options.body})
        } else {
          self.emit ('file shipped', {file: name})
          self.emit('rt', {source: 'logsene', url: options.url, request: options.body, response: res.body})
        }
        if (cb) {
          cb(err, res)
        }
      })
    } catch (ex) {
      self.emit('error', {source: 'logsene', err: ex, body: data})
    }
  })
}

Logsene.prototype.retransmit = function () {
  var self = this
  console.error('!!! retransmit')
  walk(self.tmpDir, function (path, stats) {
    if (/bulk/i.test(path)) {
      self.shipFile(path)
    }
  })
}

module.exports = Logsene
