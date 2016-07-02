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
  this.options = options || {tmpDir: os.tmpDir(), maxStoredRequests: 1000}
  this.tmpDir = options.tmpDir
  this.maxStoredRequests = options.maxStoredRequests || 1000
  this.storedFiles = []
  this.retransmitIndex=0
  this.tid = setInterval(function () {
    this.retransmitNext()
  }.bind(this), options.interval || 60000)
  mkpath(this.tmpDir, function (err) {
    if (err) {
      log('Error: can not activate disk buffer for logsene-js: ' + err)
    }
  })
}
util.inherits(DiskBuffer, events.EventEmitter)

DiskBuffer.prototype.retransmitNext = function () {
  if (this.storedFiles.length === 0) {
    return
  }
  var index = this.retransmitIndex++ 
  if (index >= this.storedFiles.length-1) {
    this.retransmitIndex = 0
    return
  }
  log('# of files: ' + this.storedFiles.length + ' current file:' + index)
  if (this.storedFiles.length > index) {
    try {
      var fileName = this.storedFiles[index]
      if (!fileName) {
        log('filename not in list:' + fileName)
        return
      }
      log('retransmitNext: ' + fileName)
      try {
        fs.statSync(fileName)
      } catch (fsStatErr) {
        this.rmFile(fileName)
        return
      }
      var lockedFileName = fileName + '.lock'
      fs.renameSync(fileName, lockedFileName)
      var buffer = fs.readFileSync(lockedFileName)
      this.emit('retransmit-req', {fileName: lockedFileName, buffer: buffer})
    } catch (err) {
      console.error('retransmitNext: ' + err.message)
    }
  }
}

DiskBuffer.prototype.syncFileListFromDir = function () {
  try {
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
            fs.renameSync(fName, fName.substring(0,fName.length-5))
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
  } catch (err) {
    this.storedFiles = []
  }
  log('fileList: ' + this.storedFiles)
}

DiskBuffer.prototype.addFile = function (fileName) {
  this.storedFiles.push(fileName)
}

DiskBuffer.prototype.rmFile = function (fileName) {
  var index = this.storedFiles.indexOf(fileName.replace('.lock', ''))
  if (index === -1) {
    // already done before
    return
  }
  try {
    fs.unlinkSync(fileName)
    log('rm file:' + fileName)  
    this.emit('removed', {fileName: fileName})
  } catch (err) {
    log('rmFile: could not delete file:' + err.message)
  // ignore when file was already deleted
  }
  if (index > -1) {
    this.storedFiles.splice(index, 1)
    return true
  } else {
    return false
  }
}

DiskBuffer.prototype.getFileName = function () {
  return path.join(this.tmpDir, this.storedFiles.length + '_' + new Date().getTime() + '.bulk')
}

DiskBuffer.prototype.store = function (data, cb) {
  this.storedRequestCount++
  this.checkTmpDir = true
  var fn = this.getFileName()
  if (this.storedRequestCount > this.maxStoredRequests) {
    log('disk buffer limit reached, drop old file:' + this.storedFiles[0])
    if (this.storedFiles.length>0) {
      this.rmFile(this.storedFiles[0])  
    }
  }
  this.addFile(fn)
  fs.writeFile(fn, JSON.stringify(data), function (err) {
    if (cb & err) {
      return cb(err)
    }
    if (cb) {
      return cb(null, fn)
    }
  })
}

function createDiskBuffer (options) {
  if (!diskBufferObjectCache[options.tmpDir]) {
    diskBufferObjectCache[options.tmpDir] = new DiskBuffer(options)
  }
  return diskBufferObjectCache[options.tmpDir]
}
module.exports.createDiskBuffer = createDiskBuffer
module.exports.DiskBuffer = DiskBuffer
