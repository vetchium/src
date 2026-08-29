import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const exportedDirectories = [
  "admin",
  "common",
  "global-coordinator",
  "hub",
  "problem",
];

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

async function missingSiblingFiles(root) {
  const missingFiles = [];
  for (const typeSpecFile of await findContractFiles(root, root)) {
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
  return missingFiles.sort();
}

async function expectedPackageExports(root) {
  const expectedExports = new Map();
  for (const directory of exportedDirectories) {
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
  return expectedExports;
}

// Reporting lives here rather than at module scope so importing this file for
// its exported helpers does not run the checks or set an exit code.
async function main(root) {
  let failed = false;

  const missingFiles = await missingSiblingFiles(root);
  if (missingFiles.length > 0) {
    console.error("Contract files without matching Go and TypeScript files:");
    for (const missingFile of missingFiles) {
      console.error(`- ${missingFile}`);
    }
    failed = true;
  }

  const packageJSON = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const exportProblems = packageExportProblems(
    packageJSON.exports ?? {},
    await expectedPackageExports(root),
  );
  if (exportProblems.length > 0) {
    console.error("TypeScript package exports do not match contract files:");
    for (const exportProblem of exportProblems) {
      console.error(`- ${exportProblem}`);
    }
    failed = true;
  }

  return failed;
}

async function findContractFiles(root, directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "tsp-output") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findContractFiles(root, entryPath)));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (await main(process.cwd())) {
    process.exitCode = 1;
  }
}
