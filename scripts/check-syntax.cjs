const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = fs.readdirSync(path.join(root, "dist")).filter(name => name.endsWith(".js"));
for (const name of files) {
  execFileSync(process.execPath, ["--check", path.join(root, "dist", name)], {stdio:"inherit"});
}
console.log(`Syntax passed for ${files.length} JavaScript files.`);
