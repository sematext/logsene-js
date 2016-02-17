var Logsene = require('../index.js')
var token = process.env.LOGSENE_TOKEN

describe('Logsene log ', function () {
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

describe('Logsene persistance ', function () {
  it('re-transmit', function (done) {
    this.timeout(30000)
    try {
      var logsene = new Logsene(token, 'test')
      var url = logsene.url
      logsene.diskBuffer(true, '.')
      logsene.setUrl ('http://notreachable.test')
      logsene.once('rt', function (event) {
        console.log(event.file + ' -> ' + event.url)
        done()
      })
      logsene.on ('error', function (err) {
        // console.log('error ' + err.err)
        logsene.setUrl(url)
      })
      for (var i = 0; i <= 1000; i++) {
        logsene.log('info', 'test retransmit message ' + i, {_id: 'hey', testField: 'Test custom field ' + i, counter: i, _type: 'test_type', 'dot.sep.field': 34 })
      }    
    } catch (err) {
      done(err)
    }
  })
})
