import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

// 각 계층이 참조할 수 있는 방향을 실행 가능한 규칙으로 고정한다.
const allowedDependencies: Readonly<Record<string, readonly string[]>> = {
  domain: ["domain"],
  application: ["application", "domain"],
  infrastructure: ["infrastructure", "application", "domain"],
  presentation: ["presentation", "infrastructure", "application", "domain"],
};

describe("architecture dependency direction", () => {
  it("only points dependencies inward", async () => {
    const sourceFiles = await findTypeScriptFiles(sourceRoot);
    const violations: string[] = [];

    for (const sourceFile of sourceFiles) {
      const importerLayer = layerOf(sourceFile);
      const imports = extractRelativeImports(await readFile(sourceFile, "utf8"));

      for (const importPath of imports) {
        const importedFile = resolve(dirname(sourceFile), importPath);
        const importedLayer = layerOf(importedFile);
        const allowedLayers = allowedDependencies[importerLayer] ?? [];

        if (!allowedLayers.includes(importedLayer)) {
          violations.push(
            `${relative(sourceRoot, sourceFile)} (${importerLayer}) -> ${importPath} (${importedLayer})`,
          );
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});

async function findTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return findTypeScriptFiles(path);
      }
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return files.flat();
}

function extractRelativeImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s+)["'](\.[^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const importPath = match[1];
    if (importPath !== undefined) {
      imports.push(importPath);
    }
  }
  return imports;
}

function layerOf(file: string): string {
  const relativePath = relative(sourceRoot, file);
  return relativePath.split(sep)[0] ?? "unknown";
}
