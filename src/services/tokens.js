const crypto = require('crypto');

function randomNumericCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(min + Math.random() * (max - min)));
}

function secureToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { randomNumericCode, secureToken };
