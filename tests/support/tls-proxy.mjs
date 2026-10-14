// Local stand-in for the host's TLS front end: production refuses a non-HTTPS app origin, so the local image check needs one.
// Usage: node tests/support/tls-proxy.mjs <listenPort> <targetUrl> <keyFile> <certFile>
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [listenPort, target, keyFile, certFile] = process.argv.slice(2);
if (!listenPort || !target || !keyFile || !certFile) {
  console.error('usage: tls-proxy.mjs <listenPort> <targetUrl> <keyFile> <certFile>');
  process.exit(2);
}
const upstream = new URL(target);
https
  .createServer(
    { key: readFileSync(keyFile), cert: readFileSync(certFile) },
    (request, response) => {
      const forward = http.request(
        {
          host: upstream.hostname,
          port: upstream.port,
          method: request.method,
          path: request.url,
          headers: {
            ...request.headers,
            'x-forwarded-proto': 'https',
            'x-forwarded-host': request.headers.host ?? '',
          },
        },
        (reply) => {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(response);
        },
      );
      forward.on('error', () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(forward);
    },
  )
  .listen(Number(listenPort), '127.0.0.1', () =>
    console.log(`tls-proxy https://localhost:${listenPort} -> ${target}`),
  );
