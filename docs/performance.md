# Analysis performance sample

This is one reproducible timing sample, not a performance guarantee. On 2026-11-10, the
[p-queue abort-listener change](https://github.com/sindresorhus/p-queue/commit/e9074f06fff500a13e0ef7c910ff4fc2fe65b01c)
changed two files. IntentPatch analyzed the commit against its first parent from a local partial
clone on macOS arm64 with Node.js 20.12.2. The required Git blobs were already cached by the
external evaluation before timing.

```bash
npm run build
node scripts/benchmark-analysis.mjs \
  --cwd ../p-queue \
  --base 'e9074f06fff500a13e0ef7c910ff4fc2fe65b01c^' \
  --head e9074f06fff500a13e0ef7c910ff4fc2fe65b01c \
  --iterations 5
```

The five in-process runs took **606, 519, 512, 543, and 511 ms** (median **519 ms**). Sampled
peak process RSS was **198 MiB**. The run found zero findings. The script samples RSS every 5 ms
and takes a final sample; short memory peaks may be missed. Successive runs share one Node process
and warm its caches. Results will vary with repository size, disk, runtime, machine, and whether
partial clones fetch blobs over the network.

The [external evaluation](./external-repository-evaluation.md) checks finding labels on 41 real
changes. It does not treat this timing sample as a throughput benchmark.
