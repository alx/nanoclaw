/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

/**
 * Read the OAuth access token from ~/.claude/.credentials.json (Claude CLI store).
 * Returns undefined if the file doesn't exist or lacks a token.
 */
function readClaudeCliToken(): string | undefined {
  try {
    const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = fs.readFileSync(credFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth?.accessToken || undefined;
  } catch {
    return undefined;
  }
}

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            // Read token fresh on each request so `claude setup-token` refreshes
            // are picked up without restarting. Fall back to ~/.claude/.credentials.json
            // (Claude CLI store) when not set in .env.
            const freshSecrets = readEnvFile([
              'CLAUDE_CODE_OAUTH_TOKEN',
              'ANTHROPIC_AUTH_TOKEN',
            ]);
            const oauthToken =
              freshSecrets.CLAUDE_CODE_OAUTH_TOKEN ||
              freshSecrets.ANTHROPIC_AUTH_TOKEN ||
              readClaudeCliToken();
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const MAX_ATTEMPTS = 3;
        const RETRY_DELAY_MS = 100;

        const makeUpstreamRequest = (attempt: number) => {
          const upstream = makeRequest(
            {
              hostname: upstreamUrl.hostname,
              port: upstreamUrl.port || (isHttps ? 443 : 80),
              path: req.url,
              method: req.method,
              headers,
              // Always use a fresh socket to avoid stale keep-alive connections
              agent: false,
            } as RequestOptions,
            (upRes) => {
              res.writeHead(upRes.statusCode!, upRes.headers);
              upRes.pipe(res);
            },
          );

          upstream.setTimeout(30_000, () => upstream.destroy());

          upstream.on('error', (err: NodeJS.ErrnoException) => {
            const isTransient = [
              'ECONNRESET',
              'ETIMEDOUT',
              'ECONNREFUSED',
            ].includes(err.code ?? '');
            if (isTransient && attempt < MAX_ATTEMPTS && !res.headersSent) {
              logger.warn(
                { url: req.url, attempt },
                'Credential proxy transient error, retrying',
              );
              setTimeout(
                () => makeUpstreamRequest(attempt + 1),
                RETRY_DELAY_MS * attempt,
              );
              return;
            }
            logger.error(
              { err, url: req.url },
              'Credential proxy upstream error',
            );
            if (!res.headersSent) {
              res.writeHead(502);
              res.end('Bad Gateway');
            }
          });

          upstream.write(body);
          upstream.end();
        };

        makeUpstreamRequest(1);
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}

/** Check whether a valid OAuth token is available (env or CLI credentials). */
export function hasOAuthToken(): boolean {
  const secrets = readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
  ]);
  return !!(
    secrets.CLAUDE_CODE_OAUTH_TOKEN ||
    secrets.ANTHROPIC_AUTH_TOKEN ||
    readClaudeCliToken()
  );
}
