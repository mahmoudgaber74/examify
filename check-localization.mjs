import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src/views', 'src/components', 'src/lib', 'src/locales'];
const files = execFileSync('git', ['ls-files', ...roots], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((file) => /\.(tsx?|jsx?)$/.test(file));

const allowedEnglish = [
  /\bAI\b/,
  /\bOMR\b/,
  /\bOCR\b/,
  /\bPDF\b/,
  /\bQR\b/,
  /\bSupabase\b/,
  /\bBubble Sheet\b/,
  /\bE2E\b/,
  /\b[A-Z]\b/,
  /@[a-z0-9.-]+/i,
  /https?:\/\//i,
  /data-testid/,
  /className/,
  /console\./,
];

const suspiciousEncoding = /[ØÙÂâ�]/;
const likelyVisibleEnglish = /(['"`>])([^'"`<>{}\n]*(?:Exam Builder|Quick Exam|Create Exam|Exam title|Subject|Class|Section|Answer key|Grading|Needs Review|Student Answer|Model Answer|Save Draft|Publish Exam|No data|Loading)[^'"`<>{}\n]*)/i;

const encodingHits = [];
const englishHits = [];

for (const file of files) {
  const content = readFileSync(join(process.cwd(), file), 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (suspiciousEncoding.test(line)) {
      encodingHits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
    if (likelyVisibleEnglish.test(line) && !allowedEnglish.some((pattern) => pattern.test(line))) {
      englishHits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

console.log('LOCALIZATION_CHECK');
console.log(`files=${files.length}`);
console.log(`suspicious_encoding=${encodingHits.length}`);
console.log(`potential_visible_english=${englishHits.length}`);

if (encodingHits.length) {
  console.log('\nSuspicious encoding:');
  console.log(encodingHits.slice(0, 80).join('\n'));
}

if (englishHits.length) {
  console.log('\nPotential visible English:');
  console.log(englishHits.slice(0, 80).join('\n'));
}
