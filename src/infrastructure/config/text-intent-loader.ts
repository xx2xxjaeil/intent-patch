import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const maximumIntentBytes = 64 * 1024;

/** 명시한 요청 문서만 읽고, 큰 파일·symbolic link·빈 입력은 거부한다. */
export class TextIntentLoader {
  public async load(workingDirectory: string, filePath: string): Promise<string> {
    const path = isAbsolute(filePath) ? filePath : resolve(workingDirectory, filePath);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Intent file must be a regular file: ${path}`);
    }
    const repositoryRoot = await realpath(workingDirectory);
    const actualPath = await realpath(path);
    const relativePath = relative(repositoryRoot, actualPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error(`Intent file is outside the repository: ${path}`);
    }
    if (metadata.size > maximumIntentBytes) {
      throw new Error(`Intent file exceeds the 64 KiB limit: ${path}`);
    }
    const intent = (await readFile(path, "utf8")).trim();
    if (Buffer.byteLength(intent, "utf8") > maximumIntentBytes) {
      throw new Error(`Intent file exceeds the 64 KiB limit: ${path}`);
    }
    if (intent.length === 0) throw new Error(`Intent file is blank: ${path}`);
    return intent;
  }
}
