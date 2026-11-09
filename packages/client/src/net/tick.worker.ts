// Timer in a worker: not throttled when the host tab is in the background.
setInterval(() => postMessage(0), 8);
