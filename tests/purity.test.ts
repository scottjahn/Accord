import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const simDir = join(root, 'src', 'sim');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  return specifiers;
}

describe('sim purity', () => {
  const files = sourceFiles(simDir);

  it('finds the sim sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports nothing from outside src/sim', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        const name = relative(root, file);
        if (!specifier.startsWith('.')) {
          violations.push(`${name} imports package "${specifier}"`);
          continue;
        }
        const target = resolve(dirname(file), specifier);
        if (target !== simDir && !target.startsWith(simDir + sep)) {
          violations.push(`${name} imports "${specifier}" from outside sim/`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses no ambient randomness, clock or host APIs', () => {
    const banned = /\bMath\.random\b|\bDate\b|\bperformance\.|\bprocess\.|\bwindow\.|\bdocument\.|\bconsole\./;
    const violations = files
      .filter((file) => banned.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(violations).toEqual([]);
  });
});
