import http from 'node:http';

interface WaitForServerOptions {
  host?: string;
  port: number;
  path?: string;
  timeoutMs: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
}

/** Poll an HTTP endpoint with a hard overall deadline and bounded attempts. */
export function waitForServer({
  host = '127.0.0.1',
  port,
  path = '/',
  timeoutMs,
  retryDelayMs = 200,
  requestTimeoutMs = 2_000,
}: WaitForServerOptions): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    let activeRequest: http.ClientRequest | undefined;

    const deadlineTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeRequest?.destroy();
      rejectP(new Error(`Server did not start on port ${port} within ${timeoutMs}ms`));
    }, timeoutMs);

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolveP();
    };

    const retry = () => {
      if (settled) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      setTimeout(attempt, Math.min(retryDelayMs, remaining));
    };

    const attempt = () => {
      if (settled) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;

      const request = http.get({ host, port, path }, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          succeed();
        } else {
          retry();
        }
      });
      activeRequest = request;
      request.setTimeout(Math.min(requestTimeoutMs, remaining), () => request.destroy());
      request.on('error', retry);
    };

    attempt();
  });
}
