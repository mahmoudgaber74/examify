import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

function frontendFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return frontendFiles(path);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

const source = frontendFiles('src').map((file) => readFileSync(file, 'utf8')).join('\n');

test('result publication remains database-RPC-only in the frontend', () => {
  assert.match(source, /rpc\('publish_exam_result'/);
  assert.doesNotMatch(source, /whatsapp-notification/);
  assert.doesNotMatch(source, /process-result-notifications/);
  assert.doesNotMatch(source, /publication_event_id/);
});
