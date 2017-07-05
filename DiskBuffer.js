'use strict'
var path = require('path')
var fs = require('fs')
var diskBufferObjectCache = {}
var os = require('os')
var mkpath = require('mkpath')
var util = require('util')
var events = require('events')

function log (message) {
  if (process.env.DEBUG_LOGSENE_DISK_BUFFER) {
    console.log(new Date().toISOString() + ': ' + message)
  }
}

function DiskBuffer (options) {
  this.storedRequestCount = 0
  this.fileId = 0
  this.options = options || {tmpDir: os.tmpDir(), maxStoredRequests: 1000}
  this.tmpDir = options.tmpDir
  this.maxStoredRequests = options.maxStoredRequests || 1000
  this.storedFiles = []
  this.retransmitIndex = 0
  var self = this
  this.tid = setInterval(function () {
    self.retransmitNext.call(self)
  }, options.interval || 60000)
  mkpath(this.tmpDir, function (err) {
    if (err) {
      log('Error: can not activate disk buffer for logsene-js: ' + err)
    }
    self.syncFileListFromDir()
  })
}
util.inherits(DiskBuffer, events.EventEmitter)

DiskBuffer.prototype.unlock = function (fileName) {
  try {
    fs.renameSync(fileName, fileName.replace('.lock', ''))
  } catch (err) {
  }
}
DiskBuffer.prototype.retransmitNext = function () {
  if (this.storedFiles.length === 0) {
    this.retransmitIndex = 0
    return
  }
  this.retransmitIndex = this.retransmitIndex + 1
  if (this.retransmitIndex >= this.storedFiles.length) {
    this.retransmitIndex = 0
  }
  var index = this.retransmitIndex
  log('# of files: ' + this.storedFiles.length + ' current file:' + index)
  if (this.storedFiles.length >= index) {
    try {
      var fileName = this.storedFiles[index]
      if (!fileName) {
        log('filename not in list:' + fileName + ' ' + this.storedFiles.length)
        return
      }
      log('retransmitNext: ' + fileName)
      try {
        fs.statSync(fileName)
      } catch (fsStatErr) {
        // this.rmFile(fileName)
        return
      }
      var lockedFileName = fileName + '.lock'
      fs.renameSync(fileName, lockedFileName)
      var buffer = fs.readFileSync(lockedFileName)
      var self = this
      setImmediate(function () {
        self.emit('retransmit-req', {fileName: lockedFileName, buffer: buffer})
      })
    } catch (err) {
      // console.error('retransmitNext error: ' + err.message)
    }
  }
}

DiskBuffer.prototype.syncFileListFromDir = function () {
  try {
    this.cleanUp()
    this.storedFiles = fs.readdirSync(this.tmpDir)
    this.storedFiles = this.storedFiles.filter(function (fileName) {
      var rv = false
      if (/\.bulk$/.test(fileName)) {
        rv = true
      } else {
        try {
          var fName = path.join(this.tmpDir, fileName)
          var fStat = fs.statSync(fName)
          var now = Date.now()
          if (now - fStat.atime.getTime() > 1000 * 60 * 5) {
            // a bulk req. should no take longer than 5 min
            log('rename 5 min old .lock file to .bulk: ' + fName)
            fs.renameSync(fName, fName.substring(0, fName.length - 5))
            fs.unlinkSync(fName)
          }
        } catch (fsErr) {
          log('syncFileListFromDir error: ' + fsErr.message)
        }
      }
      return rv
    }.bind(this))
    this.storedFiles = this.storedFiles.map(function (fileName) {
      return path.join(this.tmpDir, fileName)
    }.bind(this))
    this.storedRequestCount = this.storedFiles.length
  } catch (err) {
    log('error syncFileListFromDir', err)
    this.storedFiles = []
  }
  log('syncFileListFromDir: ' + this.storedFiles)
}

DiskBuffer.prototype.cleanUp = function () {
  var self = this
  if (this.storedRequestCount > this.maxStoredRequests) {
    if (this.storedFiles.length > this.maxStoredRequests) {
      log('cleanUp DiskBuffer ' + this.tmpDir)
      log('stored req: ' + this.storedRequestCount + ', maxStoredReq: ' + this.maxStoredRequests)
      for (var i = 0; this.storedFiles.length >= this.maxStoredRequests; i++) {
        if (i === this.storedFiles.length) {
          break
        }
        log('disk buffer limit reached, drop old file:' + this.storedFiles[i])
        self.rmFile.call(self, this.storedFiles[i])
      }
    }
  }
}

DiskBuffer.prototype.addFile = function (fileName) {
  this.storedFiles.push(fileName)
}

DiskBuffer.prototype.rmFile = function (fileName) {
  if (!fileName) {
    return
  }
  var index = this.storedFiles.indexOf(fileName.replace('.lock', ''))
  if (index < 0) {
    // already done before
    // this.emit('removed', {fileName: fileName})
    return
  }
  try {
    fs.unlinkSync(fileName)
    log('rm file:' + fileName)
    this.emit('removed', {fileName: fileName})
  } catch (err) {
    log('rmFile: could not delete file:' + err.message)
    // ignore when file was already deleted
    this.emit('removed', {fileName: fileName})
  } finally {
    if (index > -1) {
      this.storedFiles.splice(index, 1)
      this.storedRequestCount = this.storedFiles.length
      return true
    } else {
      return false
    }
  }
}

DiskBuffer.prototype.getFileName = function () {
  this.fileId += 1
  return path.join(this.tmpDir, this.fileId + '_' + new Date().getTime() + '.bulk')
}

DiskBuffer.prototype.store = function (data, cb) {
  var self = this
  this.storedRequestCount++
  this.checkTmpDir = true
  var fn = this.getFileName()
  log('stored req: ' + this.storedRequestCount + ', maxStoredReq: ' + this.maxStoredRequests)
  this.cleanUp()
  fs.writeFile(fn, JSON.stringify(data), function (err) {
    if (cb & err) {
      return cb(err)
    }
    self.addFile.call(self, fn)
    if (cb) {
      return cb(null, fn)
    }
  })
}

function createDiskBuffer (options) {
  if (!diskBufferObjectCache[options.tmpDir]) {
    diskBufferObjectCache[options.tmpDir] = new DiskBuffer(options)
    diskBufferObjectCache[options.tmpDir].isCached = false
  } else {
    diskBufferObjectCache[options.tmpDir].isCached = true
  }
  return diskBufferObjectCache[options.tmpDir]
}
module.exports.createDiskBuffer = createDiskBuffer
module.exports.DiskBuffer = DiskBuffer
