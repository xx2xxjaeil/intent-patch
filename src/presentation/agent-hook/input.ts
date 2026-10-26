const maximumInputBytes = 256 * 1024;

/** 파싱 오류에 프롬프트 조각이 포함되지 않도록 원래 예외는 외부에 노출하지 않는다. */
export async function readAgentHookInput(
  input: AsyncIterable<string | Uint8Array>,
): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    length += bytes.byteLength;
    if (length > maximumInputBytes) throw new Error("Agent hook input exceeds 256 KiB");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Agent hook input must be valid JSON");
  }
}
