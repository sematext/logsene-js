

JavaScript client for [Logsene](http://sematext.com/logsene/index.html).
Register for a [free account](https://apps.sematext.com/users-web/register.do) or Login to Logsene to create an App Token.

# Installation

    npm install logsene-js --save

# Usage


    var Logsene = require('logsene-js')
    var logger =  new Logsene ('LOGSENE-APP-TOKEN', 'test')
    logger.log ('info', 'text message', {tags: ['a','b'], customField: 'custom-field'})


