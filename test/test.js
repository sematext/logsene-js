var Logsene = require('../index.js')
var token = process.env.LOGSENE_TOKEN

describe('Logsene log ', function () {
  it('should pass', function (done) {
    this.timeout(10000)
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
