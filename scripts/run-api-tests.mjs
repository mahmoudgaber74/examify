import { spawn } from 'node:child_process';

const tests = [
  'students-api-test.mjs',
  'academic-setup-api-test.mjs',
  'subjects-api-test.mjs',
  'exams-api-test.mjs',
  'exam-runner-persistence-api-test.mjs',
  'teacher-exam-authorization-api-test.mjs',
  'questionbank-api-test.mjs',
  'storage-api-test.mjs',
  'omr-storage-api-test.mjs',
  'omr-workflow-api-test.mjs',
  'omr-api-test.mjs',
  'ai-grading-api-test.mjs',
];

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

for (const script of tests) {
  console.log(`\n[api] ${script}`);
  await run(script);
}
