/** 잠금 파일에서 실제로 해석한 간선만 따라가며 루트 직접 의존성을 추적한다. */
export function traceDirectOrigins(
  roots: ReadonlyMap<string, string>,
  edges: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const origins = new Map<string, Set<string>>();
  const queue = [...roots].map(([id, origin]) => ({ id, origin }));
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    const known = origins.get(current.id) ?? new Set<string>();
    if (known.has(current.origin)) continue;
    known.add(current.origin);
    origins.set(current.id, known);
    for (const id of edges.get(current.id) ?? []) queue.push({ id, origin: current.origin });
  }
  return new Map([...origins].map(([id, names]) => [id, [...names].sort()]));
}
