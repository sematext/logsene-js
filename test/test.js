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
  it('retransmit', function (done) {
    this.timeout(30000)
    try {
      var logsene = new Logsene(token, 'test')
      var url = logsene.url
      logsene.diskBuffer(true, '.')
      logsene.setUrl ('http://notreachable.semateext.com')
      logsene.once('rt', function (event) {
        console.log(event)
        done()
      })
      logsene.on ('error', function (err) { 
        console.log('error ' + err.err)
        //setTimeout (function () {
        logsene.setUrl(url)        
        //}, 1000)
      })
      for (var i = 0; i <= 1001; i++) {
        logsene.log('info', 'test retransmit message ' + i, {testField: 'Test custom field ' + i, counter: i})
      }
      
    } catch (err) {
      done(err)
    }
  })
})
