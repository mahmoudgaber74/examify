import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'tutor_attachments';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg']);
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((v) => v.trim()).filter(Boolean);

const cors = (request: Request) => {
  const origin = request.headers.get('Origin');
  const local = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { 'Access-Control-Allow-Origin': origin && (local || allowedOrigins.includes(origin)) ? origin : (allowedOrigins[0] ?? ''), Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
};
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(request), 'Content-Type': 'application/json' } });

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (controller.signal.aborted) throw new Error('provider_timeout'); throw error; }
  finally { clearTimeout(timer); }
}

function isSafeAttachmentPath(path: string, userId: string, conversationId: string) {
  const parts = path.split('/');
  return parts.length === 3 && parts[0] === userId && parts[1] === conversationId && parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function hasExpectedAudioSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'audio/webm') return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (mime === 'audio/ogg') return new TextDecoder().decode(bytes.slice(0, 4)) === 'OggS';
  if (mime === 'audio/mp4') return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp';
  if (mime === 'audio/mpeg') return new TextDecoder().decode(bytes.slice(0, 3)) === 'ID3' || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  return false;
}

function detectAudioMime(bytes: Uint8Array, declaredMime?: string | null) {
  const normalized = declaredMime?.split(';', 1)[0];
  const candidates = normalized && AUDIO_MIME_TYPES.has(declaredMime ?? '') ? [normalized] : ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
  return candidates.find((candidate) => hasExpectedAudioSignature(bytes, candidate)) ?? null;
}

function hasExpectedImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'image/png') return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  return false;
}

function detectImageMime(bytes: Uint8Array, declaredMime?: string | null) {
  const candidates = declaredMime && IMAGE_MIME_TYPES.has(declaredMime) ? [declaredMime] : ['image/png', 'image/jpeg', 'image/webp'];
  return candidates.find((candidate) => hasExpectedImageSignature(bytes, candidate)) ?? null;
}

async function transcribeAudio(apiKey: string, bytes: ArrayBuffer, mime: string) {
  const form = new FormData();
  const extension = mime === 'audio/ogg' ? 'ogg' : mime === 'audio/mp4' ? 'm4a' : mime === 'audio/mpeg' ? 'mp3' : 'webm';
  form.append('file', new Blob([bytes], { type: mime }), `tutor-audio.${extension}`);
  form.append('model', Deno.env.get('AI_TUTOR_TRANSCRIPTION_MODEL') ?? 'gpt-4o-mini-transcribe');
  const response = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form }, Number(Deno.env.get('AI_TUTOR_TRANSCRIPTION_TIMEOUT_MS') ?? 30000));
  if (!response.ok) throw new Error('transcription_provider_unavailable');
  const result = await response.json() as { text?: unknown };
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('transcription_invalid_response');
  return result.text.trim();
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return json(request, { error: 'method_not_allowed' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json(request, { error: 'authorization_required' }, 401);
  try {
    const service = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: auth, error: authError } = await service.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (authError || !auth.user) return json(request, { error: 'unauthorized' }, 401);
    const input = await request.json() as { conversation_id?: string; content?: string; attachment_url?: string; attachment_type?: 'image' | 'audio' };
    if (!input.conversation_id || (!input.content?.trim() && !input.attachment_url) || input.content?.length > 20000) return json(request, { error: 'invalid_tutor_message' }, 400);
    if (input.attachment_type && !['image', 'audio'].includes(input.attachment_type)) return json(request, { error: 'invalid_attachment_type' }, 400);
    const { data: conversation } = await service.from('tutor_conversations').select('id, user_id, institution_id').eq('id', input.conversation_id).eq('user_id', auth.user.id).eq('status', 'active').maybeSingle();
    if (!conversation) return json(request, { error: 'conversation_forbidden' }, 403);
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json(request, { error: 'tutor_ai_unavailable' }, 503);

    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: input.content?.trim() || 'Please analyze the attached learning material.' }];
    if (input.attachment_url) {
      if (!input.attachment_type || !isSafeAttachmentPath(input.attachment_url, auth.user.id, conversation.id)) return json(request, { error: 'attachment_forbidden' }, 403);
      const { data: sourceMessage } = await service.from('tutor_messages').select('id, attachment_url, attachment_type, attachment_mime_type').eq('conversation_id', conversation.id).eq('user_id', auth.user.id).eq('role', 'student').eq('attachment_url', input.attachment_url).eq('attachment_type', input.attachment_type).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!sourceMessage) return json(request, { error: 'attachment_not_found' }, 404);
      if (input.attachment_type === 'audio') {
        const { data: audioFile, error: downloadError } = await service.storage.from(BUCKET).download(input.attachment_url);
        if (downloadError || !audioFile) return json(request, { error: 'attachment_unavailable' }, 503);
        if (audioFile.size <= 0 || audioFile.size > MAX_AUDIO_BYTES) return json(request, { error: 'attachment_too_large' }, 413);
        const bytes = new Uint8Array(await audioFile.arrayBuffer());
        const mime = detectAudioMime(bytes, sourceMessage.attachment_mime_type || audioFile.type);
        if (!mime) return json(request, { error: 'unsupported_audio_format' }, 415);
        let transcript: string;
        try { transcript = await transcribeAudio(apiKey, bytes.buffer, mime); }
        catch (error) {
          const reason = error instanceof Error ? error.message : 'transcription_provider_unavailable';
          if (reason === 'provider_timeout') return json(request, { error: 'tutor_transcription_timeout' }, 504);
          if (reason === 'transcription_invalid_response') return json(request, { error: 'tutor_transcription_invalid_response' }, 502);
          return json(request, { error: 'tutor_transcription_unavailable' }, 503);
        }
        await service.from('tutor_messages').update({ audio_transcript: transcript }).eq('id', sourceMessage.id).eq('user_id', auth.user.id);
        content[0] = { type: 'input_text', text: `${input.content?.trim() ? `${input.content.trim()}\n\n` : ''}Transcript of the user's voice message:\n${transcript}` };
      } else {
        const { data: imageFile, error: downloadError } = await service.storage.from(BUCKET).download(input.attachment_url);
        if (downloadError || !imageFile) return json(request, { error: 'attachment_unavailable' }, 503);
        if (imageFile.size <= 0 || imageFile.size > MAX_IMAGE_BYTES) return json(request, { error: 'attachment_too_large' }, 413);
        const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
        if (!detectImageMime(imageBytes, sourceMessage.attachment_mime_type || imageFile.type)) return json(request, { error: 'unsupported_image_format' }, 415);
        const { data: signed, error: signedError } = await service.storage.from(BUCKET).createSignedUrl(input.attachment_url, 300);
        if (signedError || !signed?.signedUrl) return json(request, { error: 'attachment_unavailable' }, 503);
        content.push({ type: 'input_image', image_url: signed.signedUrl, detail: 'auto' });
      }
    }

    const providerResponse = await fetchWithTimeout('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('AI_TUTOR_MODEL') ?? 'gpt-4o', input: [{ role: 'user', content }], metadata: { conversation_id: conversation.id, attachment_type: input.attachment_type ?? 'none' } }) }, Number(Deno.env.get('AI_TUTOR_TIMEOUT_MS') ?? 30000));
    if (!providerResponse.ok) return json(request, { error: 'tutor_ai_unavailable' }, 503);
    const provider = await providerResponse.json() as { output_text?: string };
    const reply = provider.output_text?.trim();
    if (!reply) return json(request, { error: 'tutor_ai_invalid_response' }, 502);
    const { data: message, error: insertError } = await service.from('tutor_messages').insert({ conversation_id: conversation.id, user_id: auth.user.id, role: 'tutor', content: reply }).select('id, role, content, created_at').single();
    if (insertError || !message) return json(request, { error: 'tutor_reply_save_failed' }, 500);
    return json(request, { message });
  } catch (error) {
    if (error instanceof Error && error.message === 'provider_timeout') return json(request, { error: 'tutor_ai_timeout' }, 504);
    return json(request, { error: 'tutor_ai_unavailable' }, 503);
  }
});
