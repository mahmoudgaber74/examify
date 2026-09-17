import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../supabase/functions/ai-tutor/index.ts', import.meta.url), 'utf8');
const tutor = await readFile(new URL('../src/views/Tutor.tsx', import.meta.url), 'utf8');

test('Tutor audio uses the transcription boundary and multipart file upload', () => {
  assert.match(edge, /\/v1\/audio\/transcriptions/);
  assert.match(edge, /form\.append\('file'/);
  assert.match(edge, /audio_transcript/);
  assert.match(edge, /Transcript of the user's voice message/);
  assert.doesNotMatch(edge, /An audio attachment is available for transcription at this signed URL/);
});

test('Tutor audio validates ownership, format, size, and bounded provider calls', () => {
  assert.match(edge, /isSafeAttachmentPath\(input\.attachment_url, auth\.user\.id, conversation\.id\)/);
  assert.match(edge, /MAX_AUDIO_BYTES/);
  assert.match(edge, /hasExpectedAudioSignature/);
  assert.match(edge, /AI_TUTOR_TRANSCRIPTION_TIMEOUT_MS/);
  assert.match(edge, /AI_TUTOR_TIMEOUT_MS/);
});

test('Tutor selects a supported MediaRecorder MIME type instead of assuming WebM', () => {
  assert.match(tutor, /MediaRecorder\.isTypeSupported/);
  assert.match(tutor, /audio\/ogg;codecs=opus/);
  assert.match(tutor, /recorder\.mimeType/);
});
