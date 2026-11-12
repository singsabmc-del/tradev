// Full API suite on the Firebase / Firestore backend (in-memory Firestore REST mock).
process.env.TEST_DB = 'firestore';
require('./suite');
