'use strict';
// Picks the storage backend: DB_PROVIDER=firestore (Firebase) or supabase.
// Defaults to firestore when Firebase credentials are configured, otherwise supabase.
const config = require('../config');

module.exports = config.dbProvider === 'firestore' ? require('./firestore') : require('./supabase');
