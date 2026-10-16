import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface SecretPattern {
  readonly name: string;
  readonly regex: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'Brevo / Sendinblue API Key',
    regex: /xkeysib-[a-f0-9]{64}-[a-zA-Z0-9]+/i,
  },
  {
    name: 'Private Key Block',
    regex: /^[ \t]*-----BEGIN\s+(?:RSA|OPENSSH|EC|DSA|PGP|ENCRYPTED)?\s*PRIVATE KEY-----[ \t]*$/,
  },
  {
    name: 'Generic API Secret Assignment',
    regex: /(?:api[_-]?key|secret[_-]?token|smtp[_-]?pass(?:word)?|auth[_-]?token)\s*[:=]\s*["']([A-Za-z0-9_-]{24,})["']/i,
  },
  {
    name: 'Cloudflare Global API Key',
    regex: /(?:CLOUDFLARE|CF)_(?:API_KEY|AUTH_KEY)\s*[:=]\s*["']([a-f0-9]{37,45})["']/i,
  },
  {
    name: 'Hardcoded Bearer Token',
    regex: /bearer\s+[a-zA-Z0-9_\-\.]{32,}/i,
  },
];

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.system_generated',
]);

const IGNORE_FILES = new Set([
  'package-lock.json',
]);

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else if (entry.isFile()) {
      if (!IGNORE_FILES.has(entry.name)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function scanRepository(rootDir: string = process.cwd()): {
  clean: boolean;
  findings: Array<{ file: string; rule: string; line: number }>;
} {
  const files = getAllFiles(rootDir);
  const findings: Array<{ file: string; rule: string; line: number }> = [];

  for (const file of files) {
    const relPath = relative(rootDir, file);
    // Skip this script itself to prevent false positives from regex literals
    if (relPath === 'scripts/scan-secrets.ts') {
      continue;
    }

    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.regex.test(line)) {
            findings.push({
              file: relPath,
              rule: pattern.name,
              line: index + 1,
            });
          }
        }
      });
    } catch (err: unknown) {
      console.warn(`[WARN] Could not read file ${relPath}:`, err);
    }
  }

  return {
    clean: findings.length === 0,
    findings,
  };
}

function run(): void {
  console.log('[SECRET SCAN] Scanning repository files for potential credentials and secrets...');
  const result = scanRepository();

  if (result.clean) {
    console.log('[PASS] Zero exposed secrets or private keys detected in repository.');
    process.exit(0);
  } else {
    console.error(`[FAIL] Detected ${result.findings.length} potential secret(s):`);
    for (const f of result.findings) {
      console.error(`  - ${f.file}:${f.line} [${f.rule}]`);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
