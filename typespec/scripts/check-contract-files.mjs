import { access, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const contractFiles = await findContractFiles(root);
const missingFiles = [];

for (const typeSpecFile of contractFiles) {
  const stem = typeSpecFile.slice(0, -".tsp".length);
  for (const extension of [".go", ".ts"]) {
    const matchingFile = `${stem}${extension}`;
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
