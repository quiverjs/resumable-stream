
var fs = require('fs')
var path = require('path')
var http = require('http')
var should = require('should')
var async = require('async')
var createResumableStream = require('../lib/resumable-stream.js').createResumableStream

var testPort = 8008
var testFile = path.join(__dirname, '../lib/resumable-stream.js')
var throttleTime = 100

var fileToText = function(filePath, callback) {
  var buffer = ''
  var readStream = fs.createReadStream(filePath)

  readStream.on('data', function(data) {
    buffer += data
  })
  readStream.on('end', function() {
    callback(buffer)
  })
  readStream.on('error', function(err) {
    throw err
  })
}

var testResumable = function(originalContent, readStream, callback) {
  readStream.pause()

  var buffer = ''
  var pausing = true

  var resumeStream = function() {
    setTimeout(function() {
      pausing = false
      readStream.resume()
    }, throttleTime)
  }

  readStream.on('data', function(data) {
    if(pausing) throw new Error('should not receive data when stream is paused')

    // console.log('received', data.length, 'of data')
    buffer += data
    readStream.pause()
    pausing = true

    resumeStream()
  })

  readStream.on('end', function() {
    buffer.should.equal(originalContent)
    callback(null)
  })

  resumeStream()
}

var testServer = http.createServer(function(request, response) {
  fs.createReadStream(testFile).pipe(response)
}).listen(testPort)

var getTestHttpResponseStream = function(callback) {
  var request = http.request({
    hostname: '127.0.0.1',
    port: testPort
  })
  .on('response', callback)
  .end()
}

var getTestFileReadStream = function(callback) {
  var readStream = fs.createReadStream(testFile)
  callback(readStream)
}

var testWithResumableStream = function(getStream, originalContent, callback) {
  getStream(function(readStream) {
    testResumable(originalContent, createResumableStream(readStream), callback)
  })
}

var testWithNormalStream = function(getStream, originalContent, callback) {
  getStream(function(readStream) {
    testResumable(originalContent, readStream, callback)
  })
}

describe('basic test of resumable stream', function() {
  it('should able to be paused and resumed correctly', function(callback) {
    fileToText(testFile, function(originalContent) {
      async.parallel([
        function(callback) {
          testWithResumableStream(getTestHttpResponseStream, originalContent, callback)
        },
        function(callback) {
          testWithResumableStream(getTestFileReadStream, originalContent, callback)
        },
        function(callback) {
          testWithNormalStream(getTestHttpResponseStream, originalContent, callback)
        },
        function(callback) {
          testWithNormalStream(getTestFileReadStream, originalContent, callback)
        }
      ], callback)
    })
  })
})