'use strict';
// Error raised by any storage backend. `message` carries a code such as INSUFFICIENT_BALANCE
// (raised inside Firestore transactions); api.js maps codes to user messages.
class DbError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
module.exports = { DbError };
