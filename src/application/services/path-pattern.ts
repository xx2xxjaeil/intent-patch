/** Git 경로용 최소 glob 문법(*, **, ?)을 정규식으로 변환해 전체 경로를 비교한다. */
export function matchesPathPattern(path: string, pattern: string): boolean {
  return new RegExp(`^${toRegularExpression(pattern)}$`, "u").test(path);
}

function toRegularExpression(pattern: string): string {
  let expression = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      expression += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
      continue;
    }
    if (character === "*") {
      expression += "[^/]*";
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += escapeRegularExpression(character ?? "");
  }

  return expression;
}

function escapeRegularExpression(value: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(value) ? `\\${value}` : value;
}
