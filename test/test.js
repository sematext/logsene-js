var Logsene = require('../index.js')
var token = process.env.LOGSENE_TOKEN || 'YOUR_TEST_TOKEN'
process.env.LOGSENE_URL='http://127.0.0.1:19200/_bulk'
if (!process.env.LOGSENE_URL) {
  process.env.LOGSENE_URL='http://apps1.test.sematext.com:8088/_bulk'
}

console.log('Receiver: ' + process.env.LOGSENE_URL)
console.log('Token: ' + process.env.LOGSENE_TOKEN)
var http = require('http')
http.createServer(function (req, res) {
          res.writeHead(200, {'Content-Type': 'text/plain'})
          req.on('data', function (data) {
            // console.log(data.toString().substring(0,10))
          })
          req.on('end', function () {
            res.end('{"code":"200"}\n')
          })
          // console.log(req.path)
  }).listen(19200, '127.0.0.1')

var MAX_MB = Number(process.env.LOAD_TEST_MAX_MB)||30
describe('Logsene Load Test ', function () {
  it('memory keeps below ' + MAX_MB + ' MB since start', function (done) {
    this.timeout(120000)
    try {
      console.log('\t\tLOAD_TEST_MAX_MB: ' + MAX_MB)
      var logCount = Number(process.env.LOAD_TEST_SIZE) || 50000
      console.log('\t\tLOAD_TEST_SIZE: ' + logCount)

      var memory = process.memoryUsage().heapUsed
      var counter = 0
      
      var logsene = new Logsene(token, 'test', process.env.LOGSENE_URL, './')
      var start = new Date().getTime()
      var doneCalled = false
      console.log('\tRSS: ' + process.memoryUsage().rss / 1024 / 1024 + ' MB')
      console.log('\tHeap used: ' + process.memoryUsage().heapUsed / 1024 / 1024 + ' MB')
        
      function evtH (event) {
        if (doneCalled) {
          return
        }
        counter = counter + event.count
        var memory2 = 0
        if (counter >= logCount) {
          memory2 = process.memoryUsage().heapUsed
          var heapDiff = ((memory2 - memory) / 1024 / 1024)
          console.log('\tHeap diff: ' + heapDiff + ' MB')
          console.log('\tHeap used: ' + process.memoryUsage().heapUsed / 1024 / 1024 + ' MB')
          console.log('\tRSS: ' + process.memoryUsage().rss / 1024 / 1024 + ' MB')
          console.log('\tTransmission duration for ' + counter + ' logs: ' + (new Date().getTime() - start) / 1000 + ' sec.')
          if (heapDiff < MAX_MB) {
            doneCalled = true
            done()
          } else {
            done(new Error('Too much memory used:' + heapDiff + ' MB'))
          }
        }
      }

      logsene.on('log', evtH)
      logsene.once('error', function (event) {
        done(event)
      })
      logsene.on('error', console.log)
      for (var i = 0; i < logCount; i++)
        logsene.log('info', 'test message ' + i, {testField: 'Test custom field ' + i, counter: i})
    } catch (err) {
      done(err)
    }
  })
})

describe('Logsene constructor', function () {
  it('should fail without a token', function (done) {
    var emptyTokens = [undefined, null, '']
    emptyTokens.forEach(function (token) {
      try {
        new Logsene(token)
        done(new Error('Should throw exception'))
      } catch(err) {}
    })
    done()
  })
})

describe('Logsene log ', function () {
  it('should not throw circular reference error', function (done) {
    var logsene = new Logsene(token, 'test')
    logsene.on('error', console.log)
    function Foo () {
      this.abc = 'Hello'
      this.circular = this
    }
    var foo = new Foo()
    try {
      logsene.log('info', 'circular test', foo)
      if (logsene.bulkReq.getContentsAsString('utf-8').indexOf('[Circular') !== -1) {
        done()
      } else {
        done(new Error('The circular reference was not caught'))
      }
    } catch(err) {
      done(err)
    }
  })
  it('logs have default fields message, @timestamp, host, ip + custom fields', function (done) {
    this.timeout(20000)
    try {
      var logsene = new Logsene(token, 'test', process.env.LOGSENE_URL)
      // check for all required fields!
      logsene.once('logged', function (event) {
        if (!event.msg.testField || !event.msg.message || !event.msg['@timestamp'] || !event.msg.severity || !event.msg.host || !event.msg.ip) {
          done(new Error('missing fields in log: ' + JSON.stringify(event.msg)))
        } else {
          if (event.msg.message == 'test')
            done()
        }
      })
      logsene.once('error', function (event) {
        done(event)
      })
      logsene.log('info', 'test', {testField: 'Test custom field '})
    } catch (err) {
      done(err)
    }
  })
  it('transmit', function (done) {
    this.timeout(20000)
    try {
      var logsene = new Logsene(token, 'test', process.env.LOGSENE_URL)
      // check for all required fields!
      logsene.on('logged', function (event) {
        if (!event.msg.message || !event.msg['@timestamp'] || !event.msg.severity || !event.msg.host || !event.msg.ip) {
          done(new Error('missing fields in log:' + JSON.tringify(event.msg)))
        }
      })
      logsene.once('log', function (event) {
        done()
      })
      logsene.once('error', function (event) {
        done(event)
      })
      logsene.on('error', console.log)
      for (var i = 0; i <= 100; i++)
        logsene.log('info', 'test message ' + i, {testField: 'Test custom field ' + i, counter: i})
    } catch (err) {
      done(err)
    }
  })
})

describe('Logsene DiskBuffer ', function () {
  it('re-transmit', function (done) {
    this.timeout(50000)
    process.env.DEBUG_LOGSENE_DISK_BUFFER = true
    var DiskBuffer = require('../DiskBuffer.js')
    var db = DiskBuffer.createDiskBuffer({
      tmpDir: './tmp',
      interval: 2000
    })
    db.syncFileListFromDir()
    db.on('retransmit-req', function (event) {
        db.rmFile(event.fileName)
        db.retransmitNext()
    })
    db.once('removed', function () {
      done()
    })
    setTimeout (function () {
      db.store({message: 'hello'}, function () {
        db.retransmitNext()
      })
    }, 1000)
    
  })
})

describe('Logsene persistance ', function () {
  it('re-transmit', function (done) {
    this.timeout(70000)
    try {
      process.env.LOGSENE_DISK_BUFFER_INTERVAL = 2000
      var logsene = new Logsene(token, 'test', process.env.LOGSENE_URL, './mocha-test')
      var url = logsene.url
      logsene.diskBuffer(true, './mocha-test')
      logsene.setUrl('http://notreachable.test')
      logsene.db.once('removed', function (event) {
        done()
      })
      logsene.on('error', function (err) {
        if (err) {
          logsene.setUrl(process.env.LOGSENE_URL)
        }
      })
      setTimeout(function () {
        for (var i = 0; i <= 1001; i++) {
          logsene.log('info', 'test retransmit message ' + i, {_id: 'hey', testField: 'Test custom field ' + i, counter: i, _type: 'test_type', 'dot.sep.field': 34 })
        }
      }, 1000)
      
      
    } catch (err) {
      done(err)
    }
  })
})
