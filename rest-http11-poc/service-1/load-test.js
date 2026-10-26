const { performance } = require("node:perf_hooks");

const total = Number(process.argv[2] || 1000);
const concurrency = Number(process.argv[3] || 20);

async function worker(count, results) {
  for (let i = 0; i < count; i++) {
    const start = performance.now();

    try {
      const response = await fetch("http://localhost:3002/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: 10, b: 20 })
      });

      await response.json();
      results.latencies.push(performance.now() - start);

      if (response.status === 200) results.success++;
      else results.errors++;
    } catch {
      results.errors++;
    }
  }
}

async function main() {
  const results = { success: 0, errors: 0, latencies: [] };
  const start = performance.now();
  const base = Math.floor(total / concurrency);
  const remainder = total % concurrency;

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      worker(base + (i < remainder ? 1 : 0), results)
    )
  );

  const elapsed = (performance.now() - start) / 1000;
  const times = results.latencies.sort((a, b) => a - b);
  const percentile = p => times[Math.min(
    Math.ceil(p * times.length) - 1, times.length - 1
  )];

  console.log("\n--- REST / HTTP/1.1 RESULTS ---");
  console.log("Total requests:", total);
  console.log("Successful responses:", results.success);
  console.log("Errors:", results.errors);
  console.log("Elapsed seconds:", elapsed.toFixed(2));
  console.log("Throughput:", (total / elapsed).toFixed(2), "requests/sec");

  if (times.length) {
    console.log("Average latency:", (
      times.reduce((sum, t) => sum + t, 0) / times.length
    ).toFixed(2), "ms");
    console.log("p95 latency:", percentile(0.95).toFixed(2), "ms");
    console.log("p99 latency:", percentile(0.99).toFixed(2), "ms");
  }
}

main();