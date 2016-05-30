var Logsene = require('../index.js')
var token = process.env.LOGSENE_TOKEN

describe('Logsene constructor', function() {
  it('should fail without a token', function(done) {
    var emptyTokens = [undefined, null, '']
    emptyTokens.forEach(function(token) {
      try {
        new Logsene(token)
        done(new Error('Should throw exception'))
      } catch(err) {
      }
    })
    done()
  })
})

describe('Logsene log ', function () {
  it('should not throw circular reference error', function(done) {
    var logsene = new Logsene(token, 'test')
    function Foo() {
      this.abc = 'Hello'
      this.circular = this
    }
    var foo = new Foo()
    try {
      logsene.log('info', 'circular test', foo)
      if (logsene.bulkReq.indexOf('[Circular') !== -1) {
        done();
      } else {
        done(new Error('The circular reference was not caught'))
      }
    } catch(err) {
      done(err);
    }
  });

  it('transmit', function (done) {
    this.timeout(20000)
    try {
      var logsene = new Logsene(token, 'test')
      logsene.once('log', function (event) {
        done()
      })
      logsene.once('error', function (event) {
        done(event)
      })
      logsene.on ('error', console.log)
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
    process.env.DEBUG_LOGSENE_DISK_BUFFER=true
    var DiskBuffer = require('../DiskBuffer.js')
    var db = DiskBuffer.createDiskBuffer({
      tmpDir: './tmp',
      interval: 1000
    })
    db.syncFileListFromDir()
    db.on('retransmit-req', function (event) {
        db.rmFile(event.fileName)
        db.retransmitNext() 
    })
    db.once('removed', function () {
      done()
    })
    db.store('hello')
    db.retransmitNext()
  })
})

describe('Logsene persistance ', function () {
  it('re-transmit', function (done) {
    this.timeout(50000)
    try {
      process.env.LOGSENE_DISK_BUFFER_INTERVAL=500
      var logsene = new Logsene(token, 'test')
      var url = logsene.url 
      logsene.diskBuffer(true, '.')
      logsene.setUrl('http://notreachable.test')
      logsene.db.once('removed', function (event) {
        done()
      })
      //logsene.once('rt', function (event) {
      //  done()
      //})
      logsene.on ('error', function (err) {
        if (err) {
          logsene.setUrl(url) 
        }
      })
      for (var i = 0; i <= 1000; i++) {
        logsene.log('info', 'test retransmit message ' + i, {_id: 'hey', testField: 'Test custom field ' + i, counter: i, _type: 'test_type', 'dot.sep.field': 34 })
      }
    } catch (err) {
      done(err)
    }
  })
})

