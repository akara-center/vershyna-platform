// Creates disposable synthetic QA on a separate local origin. Never serve on the live origin.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const ref = process.argv[2] || "origin/backup/pre-structure-2026-11-22";
const out = path.join(root, ".browser-check");
const files = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "dist/"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
if (!files.includes("dist/index.html")) throw new Error("Baseline has no dist/index.html");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of files) {
  const target = path.join(out, "baseline", file.slice(5));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, execFileSync("git", ["show", `${ref}:${file}`], { cwd: root }));
}
fs.cpSync(path.join(root, "dist"), path.join(out, "candidate"), { recursive: true });
fs.copyFileSync(path.join(root, "tests/browser-check.html"), path.join(out, "index.html"));
console.log(`Prepared ${out} against ${ref}. Serve this directory on a separate local port.`);
