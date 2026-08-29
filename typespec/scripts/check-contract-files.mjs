import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const contractFiles = await findContractFiles(root);
const missingFiles = [];

for (const typeSpecFile of contractFiles) {
  const stem = typeSpecFile.slice(0, -".tsp".length);
  const parsedStem = path.parse(stem);
  const matchingFiles = [
    path.join(parsedStem.dir, `${parsedStem.name.replaceAll("-", "_")}.go`),
    `${stem}.ts`,
  ];
  for (const matchingFile of matchingFiles) {
    try {
      await access(matchingFile);
    } catch {
      missingFiles.push(path.relative(root, matchingFile));
    }
  }
}

if (missingFiles.length > 0) {
  console.error("Contract files without matching Go and TypeScript files:");
  for (const missingFile of missingFiles.sort()) {
    console.error(`- ${missingFile}`);
  }
  process.exitCode = 1;
}

const packageJSON = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const expectedExports = new Map();
for (const directory of [
  "admin",
  "common",
  "global-coordinator",
  "hub",
  "problem",
]) {
  const sourceFiles = await findTypeScriptFiles(path.join(root, directory));
  for (const sourceFile of sourceFiles) {
    const relativeFile = path
      .relative(root, sourceFile)
      .split(path.sep)
      .join("/");
    const target = `./${relativeFile}`;
    expectedExports.set(target.slice(0, -".ts".length), target);
  }
}
const exportProblems = packageExportProblems(
  packageJSON.exports ?? {},
  expectedExports,
);
if (exportProblems.length > 0) {
  console.error("TypeScript package exports do not match contract files:");
  for (const exportProblem of exportProblems) {
    console.error(`- ${exportProblem}`);
  }
  process.exitCode = 1;
}

export function packageExportProblems(actualExports, expectedExports) {
  const problems = [];
  for (const [exportName, target] of expectedExports) {
    if (!(exportName in actualExports)) {
      problems.push(`missing ${exportName} -> ${target}`);
    } else if (actualExports[exportName] !== target) {
      problems.push(
        `${exportName} points to ${String(actualExports[exportName])}, want ${target}`,
      );
    }
  }
  for (const exportName of Object.keys(actualExports)) {
    if (!expectedExports.has(exportName)) {
      problems.push(`unexpected ${exportName}`);
    }
  }
  return problems.sort();
}

async function findContractFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "tsp-output") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findContractFiles(entryPath)));
    } else if (
      entry.name.endsWith(".tsp") &&
      path.relative(root, entryPath) !== "main.tsp"
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findTypeScriptFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTypeScriptFiles(entryPath)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(entryPath);
    }
  }

  return files;
}
