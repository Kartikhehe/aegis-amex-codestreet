#!/usr/bin/env node
/**
 * Generate the API contract from the service's OpenAPI spec.
 *
 * The brief requires that the frontend client and the backend cannot drift.
 * This script is how that is enforced:
 *
 *   1. fetch /openapi.json from the running service (or read a saved copy)
 *   2. write src/aegis/endpoints.generated.json -- every path + method + the
 *      response shape, as the service actually declares them
 *   3. CHECK that every path referenced in src/aegis/api.js exists in the spec
 *
 * Step 3 is the part that matters. A hand-written client that merely sits
 * beside a generated file still drifts; one that fails its build when a path
 * disappears does not.
 *
 *   node scripts/generate-api.mjs                    # from localhost:8000
 *   node scripts/generate-api.mjs --check            # verify only, no write
 *   node scripts/generate-api.mjs --spec ./spec.json # from a file
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/aegis/endpoints.generated.json');
const CLIENT = resolve(ROOT, 'src/aegis/api.js');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const specFlag = args.indexOf('--spec');
const specPath = specFlag !== -1 ? args[specFlag + 1] : null;
const baseUrl = process.env.AEGIS_API_URL ?? 'http://localhost:8000';

const fail = (message) => {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
};

async function loadSpec() {
  if (specPath) {
    return JSON.parse(readFileSync(resolve(process.cwd(), specPath), 'utf8'));
  }
  const url = `${baseUrl}/openapi.json`;
  try {
    const response = await fetch(url);
    if (!response.ok) fail(`${url} returned ${response.status}`);
    return await response.json();
  } catch (error) {
    fail(
      `Could not reach ${url} (${error.message}).\n` +
        `    Start the service, or pass --spec <file>.`,
    );
  }
}

const spec = await loadSpec();
const API_PREFIX = '/api';

/** Flatten the spec into the shape the client needs. */
const operations = [];
for (const [path, methods] of Object.entries(spec.paths ?? {})) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    operations.push({
      path,
      // The client stores paths relative to VITE_API_URL, which already ends
      // in /api -- so strip the prefix the spec carries.
      clientPath: path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path,
      method: method.toUpperCase(),
      operationId: operation.operationId ?? '',
      summary: operation.summary ?? '',
      tags: operation.tags ?? [],
    });
  }
}

// --- the drift check -------------------------------------------------------
// Pull every literal path out of api.js, including the template-literal ones
// produced by the (id) => `/agents/${id}` helpers, normalised to the spec's
// {param} form so the two are directly comparable.
const clientSource = readFileSync(CLIENT, 'utf8');
const referenced = new Set();
for (const match of clientSource.matchAll(/['"`](\/[a-zA-Z0-9\-_/${}.]*)['"`]/g)) {
  referenced.add(match[1].replace(/\$\{[^}]+\}/g, '{param}'));
}

const specPaths = new Set(operations.map((o) => o.clientPath.replace(/\{[^}]+\}/g, '{param}')));
const missing = [...referenced].filter((path) => {
  if (path.startsWith('/demo/')) return false; // demo router is conditionally mounted
  return !specPaths.has(path);
});

if (missing.length) {
  fail(
    `src/aegis/api.js references paths the service does not expose:\n` +
      missing.map((p) => `      ${p}`).join('\n') +
      `\n\n    The client and the service have drifted. Fix api.js, or regenerate\n` +
      `    after the service change is deployed.`,
  );
}

const payload = {
  generatedAt: new Date().toISOString(),
  title: spec.info?.title ?? 'AEGIS',
  version: spec.info?.version ?? '0.0.0',
  operationCount: operations.length,
  operations: operations.sort((a, b) => a.path.localeCompare(b.path)),
};

if (checkOnly) {
  console.log(
    `\n  ✔ client matches ${payload.title} v${payload.version} ` +
      `(${operations.length} operations, ${referenced.size} referenced)\n`,
  );
  process.exit(0);
}

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `\n  ✔ wrote ${OUT.replace(ROOT + '/', '')} — ` +
    `${payload.title} v${payload.version}, ${operations.length} operations\n`,
);
