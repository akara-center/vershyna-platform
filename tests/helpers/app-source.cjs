const fs = require("node:fs");
const path = require("node:path");
// Follow the real browser load order so VM tests exercise every source file.
module.exports = function appSource() {
  const root = path.resolve(__dirname, "../..");
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  return [...html.matchAll(/<script\s+src="\.\/([^"?]+\.js)(?:\?[^\"]*)?"/g)]
    .map((match) => match[1])
    .filter((name) => name !== "quest-core.js")
    .map((name) => fs.readFileSync(path.join(root, "dist", name), "utf8"))
    .join("\n");
};
