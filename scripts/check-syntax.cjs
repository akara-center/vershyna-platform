const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let checked = 0;
for (const directory of ["dist", "server"]) {
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (!/\.[cm]?js$/.test(name)) continue;
    execFileSync(process.execPath, ["--check", path.join(root, directory, name)], { stdio: "inherit" });
    checked++;
  }
}
console.log(`Syntax passed for ${checked} JavaScript files.`);
