// יציבות: Express 4 לא תופס rejections מ-async handlers — כל rejection היה unhandledRejection
// שהפיל את כל תהליך node. כאן: עטיפה גלובלית של כל ה-handlers ברמה של Layer,
// כך ש-rejection מועבר ל-next(err) ומטופל ב-errorHandler (errlog) כמו כל שגיאה.
// רישום בלבד ל-process-level — לא להפיל את התהליך על תקלה בבקשה בודדת.
const Layer = require('express/lib/router/layer');

function wrapHandler(fn) {
  if (typeof fn !== 'function' || fn.__asyncWrapped) return fn;
  const wrapped = fn.length === 4
    ? (err, req, res, next) => Promise.resolve(fn(err, req, res, next)).catch(next)
    : (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  wrapped.__asyncWrapped = true;
  return wrapped;
}

const origHandleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handleRequest(req, res, next) {
  if (this.handle && !this.handle.__asyncWrapped) this.handle = wrapHandler(this.handle);
  return origHandleRequest.call(this, req, res, next);
};
const origHandleError = Layer.prototype.handle_error;
Layer.prototype.handle_error = function handleError(err, req, res, next) {
  if (this.handle && !this.handle.__asyncWrapped) this.handle = wrapHandler(this.handle);
  return origHandleError.call(this, err, req, res, next);
};

let installed = false;
function installProcessGuards() {
  if (installed) return;
  installed = true;
  // רושמים בלבד וממשיכים — בקשה כושלת אחת לא מפילה את האתר
  process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e && e.stack || e));
  process.on('uncaughtException', (e) => console.error('[uncaughtException]', e && e.stack || e));
}

module.exports = { installProcessGuards };
