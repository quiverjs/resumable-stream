
var events = require('events')

/*
 * Forward a set of methods from the source object to the target
 * object. The result target would have the given list of methods
 * with the actual effect applied on the source object. (i.e. the
 * this object remain the source object)
 */
var forwardMethods = function(methods, source, target) {
  for(var i=0; i<methods.length; i++) {
    (function(method) {
      target[method] = function() {
        return source[method].apply(source, arguments)
      }
    })(methods[i])
  }
}

/*
 * The current version of Node.js has notorious problem in pausing streams.
 * This helper function creates a resumable stream object from a normal Node.js
 * stream that can be paused multiple times. Usage for the returned 
 * resumableStream object:
 *
 * resumableStream.pause()
 * Pause the underlying stream. If any data has been passed through before pause() is
 * called, it will be lost. pause() can be called multiple times and the stream will
 * only resume when the same number of resume() is called.
 *
 * resumableStream.resume()
 * Resume the underlying stream. Any buffer that is cached during pause will be
 * emitted immediately inside of resume(). Therefore data listeners must be set
 * before resume() is called.
 *
 * resumableStream.pipeStream()
 * The original pipe() function seem to have data loss bug when the target write 
 * stream is paused for too long. To completely avoid the default pipe() 
 * implementation, the pipe() method in resumableStream is set to null and be
 * replaced with pipeStream(). pipeStream() will use the resumableStream's own
 * pause mechanism to pause the stream when the write stream is full, to guarantee
 * that no data event will be emitted until the read stream is resumed after
 * the drain event.
 */
var createResumableStream = function(readStream) {
  // The new resumableStream object has readStream as its prototype
  var self = Object.create(readStream)

  // However we want the resumableStream object to have its own event
  // emitter that is not inherited from readStream. 
  var selfEvent = new events.EventEmitter()

  // We set new event emitter functions on self such that when say
  // self.on() called, it is actually invoking selfEvent.on().
  // With this, resumableStream inherits all the methods of readStream
  // but keep its own event emitter.
  var methods = ['on', 'emit', 'addListener', 'once', 'removeListener', 'removeAllListeners', 'listeners']
  forwardMethods(methods, selfEvent, self)
  
  // Set pipe() to null since it is buggy and we don't want to use it 
  // in our code.
  self.pipe = null
  
  var isClosed = false
  var error = null
  
  var pauses = 0
  var cachedEvents = []
  
  // If resumableStream is paused, any incoming event will be pushed to
  // the cachedEvents array for emitting when the stream is resumed.
  var cacheOrEmit = function(name, content) {
    if(pauses > 0 || cachedEvents.length > 0) {
      cachedEvents.push({
        name: name,
        content: content
      })
    } else {
      self.emit(name, content)
    }
  }
  
  // When stream events happen on readStream,
  // decide whether to cache or emit it
  // immediately in resumableStream's own 
  // event emitter.
  readStream.on('data', function(buffer) {
    cacheOrEmit('data', buffer)
  })
  
  readStream.on('end', function() {
    cacheOrEmit('end')
  })
  
  readStream.on('error', function(err) {
    cacheOrEmit('error', err)
  })
  
  var resumeStream = function() {
    // Doesn't work sometimes if we actually pause and resume the underlying stream
    // readStream.resume()

    // If pause number is decreased to zero, it will unshift an event
    // from the head of cachedEvents array and emit it immediately.
    // Since the event callback might call pause again when it is 
    // emitted, we have to check for pauses for each cached event.
    while(pauses == 0 && cachedEvents.length != 0) {
      var ev = cachedEvents.shift()
      self.emit(ev.name, ev.content)
    }
  }
  
  self.pause = function() {
    // Doesn't work sometimes if we actually pause and resume the underlying stream
    // if(pauses == 0) readStream.pause()

    // We only increase the pause counter but the underlying readStream 
    // is not paused
    pauses++
  }
  
  self.resume = function() {
    if(pauses == 0) return  console.trace('resume stream called more times than pause!')
    pauses--
    
    if(pauses == 0) {
      resumeStream()
    }
  }
  
  self.pipeStream = function(writeStream) {
    // The pausing flag is used to track whether self is
    // being paused to wait for drain event.
    var pausing = false

    // flag to track whether the write stream has been closed.
    var writeClosed = false
    
    // Listen on own's event emitter with the pause mechanism
    self.on('data', function(buffer) {
      // If the writeStream is writable and not closed,
      // then try write on it and if that return false,
      // it means the write stream is full and should pause 
      // self until drain event.
      if(writeStream.writable && !writeClosed && writeStream.write(buffer) === false) {
        pausing = true
        self.pause()
      }
    })
    
    writeStream.on('drain', function() {
      if(pausing) {
        pausing = false
        self.resume()
      }
    })
    
    // When the write stream is closed, this function is called
    // to raise the writeClosed flag and unpause the stream
    // if the stream is currently paused for the drain event.
    var onWriteStreamClosed = function() {
      if(writeClosed) return
      
      writeClosed = true
      if(pausing) {
        pausing = false
        self.resume()
      }
    }

    writeStream.on('error', onWriteStreamClosed)
    writeStream.on('close', onWriteStreamClosed)
    
    self.on('error', function(err) {
      console.log('error in read stream, closing pipe')
      writeStream.end()
    })
    
    self.on('end', function() {
      writeStream.end()
    })
  }
  
  self.originalStream = function() {
    return readStream
  }
  
  return self
}

module.exports = {
  createResumableStream: createResumableStream
}