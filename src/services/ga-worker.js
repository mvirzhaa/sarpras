const { parentPort, workerData } = require('worker_threads');
const { solve } = require('./ga');
try {
  const result = solve(workerData, p => parentPort.postMessage({ type: 'progress', ...p }));
  parentPort.postMessage({ type: 'done', result });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}
