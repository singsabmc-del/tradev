// Vercel Function: every /api/* request is rewritten here (see vercel.json).
const { handle } = require('../lib/http');

module.exports = async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Server error' }));
  }
};
