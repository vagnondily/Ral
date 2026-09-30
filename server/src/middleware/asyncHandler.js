// Wraps an async Express handler so a rejected promise reaches the central
// error handler instead of crashing the process (Express 4 does not do this
// automatically — a naive app without this wrapper is one uncaught
// rejection away from an outage).
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
