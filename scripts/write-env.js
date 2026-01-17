const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envPath });

const env = {
  CAMHUB_API_BASE: process.env.CAMHUB_API_BASE || ""
};

const output = `window.__CAMHUB_ENV__ = ${JSON.stringify(env, null, 2)};\n`;
const outPath = path.join(__dirname, "..", "env.js");

fs.writeFileSync(outPath, output, "utf8");
