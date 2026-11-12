// Full API suite on the Supabase backend (Postgres + PostgREST shim). Needs psql: PSQL_ARGS="-h localhost -U postgres"
process.env.TEST_DB = 'supabase';
require('./suite');
