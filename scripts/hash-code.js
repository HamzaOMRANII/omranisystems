// Usage: npm run hash -- 123456
// Prints the value to paste into .env as CODE_<APP>=...
const crypto = require("crypto");

const code = process.argv[2];
if (!code) {
  console.error("Usage: npm run hash -- <code>");
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(code, salt, 64).toString("hex");
console.log(`${salt}:${hash}`);
