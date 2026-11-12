// The service-account JWT that TradeV exchanges for a Google OAuth token must be a valid RS256 JWT.
'use strict';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:1';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serviceAccountJwt } = require('../lib/firestore');

test('service-account JWT is RS256-signed with the right claims', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }); // same format as a Google key file
  const jwt = serviceAccountJwt('svc@demo.iam.gserviceaccount.com', pem, 1_700_000_000);
  const [h, p, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.iss, 'svc@demo.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/datastore');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url'));
});

test('private key with escaped \\n (as pasted into env vars) is normalised', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const json = JSON.stringify({ project_id: 'p', client_email: 'e@p.iam.gserviceaccount.com', private_key: pem });
  const out = require('node:child_process').execFileSync(process.execPath, ['-e',
    "const c=require('./lib/config');process.stdout.write(JSON.stringify({p:c.firebase.projectId,ok:c.firebase.privateKey.includes('\\n-----END'),db:c.dbProvider}))"],
    { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, FIRESTORE_EMULATOR_HOST: '', FIREBASE_PROJECT_ID: '', FIREBASE_SERVICE_ACCOUNT: Buffer.from(json).toString('base64') } });
  assert.deepEqual(JSON.parse(out), { p: 'p', ok: true, db: 'firestore' });
});
