
quiver-resumable-stream
=======================

Utility function to allow the original Node.js stream to be paused and resumed correctly.

The original pause() method in the Node.js read stream was advisory only. As a result it was very hard to implement a proper way of pausing the node read stream. quiver-resumable-stream allows you to create a wrapped node read stream that pause the stream correctly. The wrapped stream can also be called pause() multiple times, and the stream will then only be resumed after the same number of resume() called.

This package is being considered deprecated since newer versions of Node.js seem to obey the pause() request correctly. And with the introduction of new read stream API in Node.js v0.10 this is no longer required.