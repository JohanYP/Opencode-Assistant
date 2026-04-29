#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm" : "npm";
const gitCommand = isWindows ? "git.exe" : "git";
const semverInputPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const validBumps = new Set([
  "major",
  "minor",
  "patch",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease",
]);

function run(command, args, shell) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run release:prepare -- <version-or-bump>",
      "",
      "Examples:",
      "  npm run release:prepare -- 0.1.0-rc.5",
      "  npm run release:prepare -- patch",
      "  npm run release:rc",
      "",
      "Notes:",
      "  - Updates package.json/package-lock.json",
      "  - Creates commit: chore(release): v<version>",
      "  - Does not create git tag",
    ].join("\n") + "\n",
  );
}

const input = process.argv[2];

if (!input || input === "-h" || input === "--help") {
  printUsage();
  process.exit(0);
}

const npmVersionArgs = ["version"];
let explicitVersionInput;

if (input === "rc") {
  npmVersionArgs.push("prerelease", "--preid=rc");
} else if (validBumps.has(input)) {
  npmVersionArgs.push(input);
} else if (semverInputPattern.test(input)) {
  explicitVersionInput = input;
  npmVersionArgs.push(input);
} else {
  process.stderr.write(`Invalid release input: ${input}. Use a bump keyword or semver value.\n`);
  printUsage();
  process.exit(2);
}

npmVersionArgs.push("--no-git-tag-version");

const packageJsonPath = resolve(process.cwd(), "package.json");
const packageJsonBefore = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const currentVersionBefore = packageJsonBefore.version;

if (explicitVersionInput && explicitVersionInput === currentVersionBefore) {
  process.stdout.write(`Version is already ${currentVersionBefore}, skipping npm version step\n`);
} else {
  run(npmCommand, npmVersionArgs, isWindows);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

run(gitCommand, ["add", "package.json", "package-lock.json"], false);
run(
  gitCommand,
  ["commit", "-m", `chore(release): v${version}`, "--", "package.json", "package-lock.json"],
  false,
);

process.stdout.write(`Prepared release commit for v${version}\n`);
process.stdout.write("Next step: git push origin main\n");
