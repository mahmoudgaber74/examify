import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const pauseAfterFailure = () => {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, 1000);
};
const runResetWithBoundedRetry = () => {
  const args = ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'db', 'reset', '--no-seed'];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync('cmd.exe', args, { stdio: 'inherit' });
    if (result.status === 0) return;
    if (attempt < 3) {
      console.error(`Local reset attempt ${attempt} failed; retrying once services settle.`);
      pauseAfterFailure();
    } else process.exit(result.status ?? 1);
  }
};

runResetWithBoundedRetry();
rmSync('test-results/security-local-fixtures.json', { force: true });
run(process.execPath, ['scripts/setup-local-security-fixtures.mjs']);
run(process.execPath, ['security/harness-smoke-local.mjs']);
run(process.execPath, ['security/runtime-matrix-local.mjs']);
run(process.execPath, ['security/run-local-security.mjs']);
