// Docker HEALTHCHECK: the server listens on the PORT the host sets (Cloud Run sets 8080), so the check reads the same variable.
const port = process.env.PORT || '8080';
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(3_000),
  });
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
