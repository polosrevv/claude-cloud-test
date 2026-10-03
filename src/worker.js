import { createJobRunner } from './jobs.js';

const run = createJobRunner();

self.onmessage = (event) => {
  try {
    const { reply, transfer } = run(event.data);
    self.postMessage(reply, transfer || []);
  } catch (err) {
    self.postMessage({ type: 'error', id: event.data.id, message: String(err && err.stack || err) });
  }
};
