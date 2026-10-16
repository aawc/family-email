import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';

interface DocIssue {
  readonly file: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

const REQUIRED_DOCS = [
  'README.md',
  'AGENTS.md',
  'PROMPT.md',
  'docs/DESIGN.md',
  'docs/dns.md',
  'docs/routing.md',
  'docs/operations.md',
  'docs/security.md',
  'docs/decisions.md',
];

const GITHUB_ALERT_REGEX = /^[ \t]*>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;
const PROHIBITED_HARNESS_REGEX = /\b(jetski|gemini|chatgpt|claude|copilot|anthropic|openai)\b/i;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

function getMarkdownFiles(dir: string, fileList: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      getMarkdownFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export function validateDocs(rootDir: string = process.cwd()): {
  errors: DocIssue[];
  warnings: DocIssue[];
} {
  const errors: DocIssue[] = [];
  const warnings: DocIssue[] = [];

  // 1. Check required documentation files
  for (const req of REQUIRED_DOCS) {
    const fullPath = resolve(rootDir, req);
    if (!existsSync(fullPath)) {
      errors.push({
        file: req,
        message: `Required documentation file does not exist: ${req}`,
        severity: 'error',
      });
    }
  }

  // 2. Scan all markdown files
  const mdFiles = getMarkdownFiles(rootDir);

  for (const fullPath of mdFiles) {
    const relPath = relative(rootDir, fullPath);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // GitHub Alert syntax prohibition
      if (GITHUB_ALERT_REGEX.test(line)) {
        errors.push({
          file: `${relPath}:${lineNum}`,
          message: `Prohibited GitHub alert syntax detected: "${line.trim()}". Alert boxes break external sync.`,
          severity: 'error',
        });
      }

      // Model and harness neutrality prohibition
      const harnessMatch = line.match(PROHIBITED_HARNESS_REGEX);
      if (harnessMatch) {
        errors.push({
          file: `${relPath}:${lineNum}`,
          message: `Prohibited model or harness name detected: "${harnessMatch[0]}" on line: "${line.trim()}". Maintain vendor-neutral terminology.`,
          severity: 'error',
        });
      }
    });

    // Check markdown links
    let match: RegExpExecArray | null;
    const linkRegex = new RegExp(MARKDOWN_LINK_REGEX);
    while ((match = linkRegex.exec(content)) !== null) {
      const rawTarget = match[2].trim();

      // Skip anchors, external web links, mailto
      if (
        rawTarget.startsWith('#') ||
        rawTarget.startsWith('http://') ||
        rawTarget.startsWith('https://') ||
        rawTarget.startsWith('mailto:')
      ) {
        continue;
      }

      // Strip query params and in-page anchor
      const targetPathOnly = rawTarget.split('#')[0].split('?')[0];
      if (!targetPathOnly) {
        continue;
      }

      const resolvedTarget = resolve(dirname(fullPath), targetPathOnly);
      if (!existsSync(resolvedTarget)) {
        errors.push({
          file: relPath,
          message: `Broken relative markdown link target: "${rawTarget}" (resolved to ${relative(rootDir, resolvedTarget)})`,
          severity: 'error',
        });
      }
    }
  }

  return { errors, warnings };
}

function run(): void {
  console.log('[DOCS VALIDATION] Starting documentation verification...');
  const { errors, warnings } = validateDocs();

  for (const w of warnings) {
    console.warn(`  [WARN] ${w.file}: ${w.message}`);
  }

  for (const e of errors) {
    console.error(`  [FAIL] ${e.file}: ${e.message}`);
  }

  console.log('----------------------------------------------------');
  console.log(`[SUMMARY] Errors: ${errors.length}, Warnings: ${warnings.length}`);

  if (errors.length > 0) {
    console.error('[FAIL] Documentation validation failed.');
    process.exit(1);
  } else {
    console.log('[PASS] All documentation verified cleanly.');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}
