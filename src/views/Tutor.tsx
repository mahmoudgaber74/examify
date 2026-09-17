import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Card, Badge, Avatar } from '../components/ui';
import { Sparkles, Send, Trash2, Loader2, Image, Mic, Square, Paperclip } from 'lucide-react';

type TutorMessage = { id: string; role: 'student' | 'tutor'; content: string; created_at?: string; attachment_url?: string | null; attachment_type?: 'image' | 'audio' | null; attachment_mime_type?: string | null; audio_transcript?: string | null; attachmentPreviewUrl?: string };
type PendingAttachment = { path: string; type: 'image' | 'audio'; mimeType: string; signedUrl: string };
const BUCKET = 'tutor_attachments';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIO_MIME_TYPES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];

export function Tutor() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function signedMessages(rows: TutorMessage[]) {
    return Promise.all(rows.map(async (message) => {
      if (!message.attachment_url) return message;
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(message.attachment_url, 60 * 60);
      return { ...message, attachmentPreviewUrl: data?.signedUrl };
    }));
  }

  async function loadSession() {
    setLoading(true); setError(null);
    const { data: conversation, error: conversationError } = await supabase.rpc('get_or_create_tutor_conversation');
    if (conversationError || !conversation) { setError('Tutor session could not be created.'); setLoading(false); return; }
    const active = Array.isArray(conversation) ? conversation[0] : conversation;
    setConversationId(active.id);
    const { data, error: messagesError } = await supabase.from('tutor_messages').select('id, role, content, created_at, attachment_url, attachment_type, attachment_mime_type, audio_transcript').eq('conversation_id', active.id).order('created_at', { ascending: true }).limit(100);
    if (messagesError) setError('Tutor session could not be loaded.');
    setMessages(await signedMessages((data as TutorMessage[]) ?? []));
    setLoading(false);
  }

  useEffect(() => { void loadSession(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  useEffect(() => () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }, []);

  async function uploadAttachment(file: File | Blob, type: 'image' | 'audio', mimeType = file.type) {
    if (!conversationId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Your session has expired.'); return; }
    const allowedTypes = type === 'image' ? IMAGE_MIME_TYPES : AUDIO_MIME_TYPES;
    if (!allowedTypes.includes(mimeType)) { setError(type === 'audio' ? 'This audio format is unavailable.' : 'This image format is unavailable.'); return; }
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) { setError('Attachment must be smaller than 10 MB.'); return; }
    const baseMimeType = mimeType.split(';', 1)[0];
    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : baseMimeType === 'audio/ogg' ? 'ogg' : baseMimeType === 'audio/mp4' ? 'm4a' : baseMimeType === 'audio/mpeg' ? 'mp3' : type === 'audio' ? 'webm' : 'jpg';
    const path = `${user.id}/${conversationId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mimeType, upsert: false });
    if (uploadError) { setError(`Attachment upload failed: ${uploadError.message}`); return; }
    const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (signedError || !signed?.signedUrl) { setError('Attachment preview is unavailable.'); return; }
    setPendingAttachment({ path, type, mimeType, signedUrl: signed.signedUrl });
  }

  async function chooseImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await uploadAttachment(file, 'image');
    event.target.value = '';
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') { setError('Voice recording is unavailable in this browser.'); return; }
    const mimeType = RECORDING_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) { setError('This browser does not support a compatible voice format.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => { stream.getTracks().forEach((track) => track.stop()); recordingStreamRef.current = null; setRecording(false); setError('Voice recording failed unexpectedly.'); };
      recorder.onstop = () => { stream.getTracks().forEach((track) => track.stop()); recordingStreamRef.current = null; const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType }); void uploadAttachment(blob, 'audio', recorder.mimeType || mimeType); setRecording(false); };
      recorderRef.current = recorder; recorder.start(); setRecording(true); setError(null);
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setError('Microphone permission was denied.');
      else if (name === 'NotFoundError') setError('No microphone was found.');
      else if (name === 'NotReadableError') setError('The microphone is busy or unavailable.');
      else if (name === 'OverconstrainedError') setError('The requested microphone is unavailable.');
      else setError('Microphone access is unavailable.');
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
    }
  }

  async function send() {
    const content = input.trim();
    if ((!content && !pendingAttachment) || sending || !conversationId) return;
    setSending(true); setError(null); setInput('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Your session has expired. Please sign in again.'); setSending(false); return; }
    const attachment = pendingAttachment;
    const { data, error: insertError } = await supabase.from('tutor_messages').insert({ conversation_id: conversationId, user_id: user.id, role: 'student', content: content || 'Please analyze this attachment.', attachment_url: attachment?.path ?? null, attachment_type: attachment?.type ?? null, attachment_mime_type: attachment?.mimeType ?? null }).select('id, role, content, created_at, attachment_url, attachment_type, attachment_mime_type, audio_transcript').single();
    if (insertError) { setError('Your message could not be saved.'); setSending(false); return; }
    if (data) setMessages((current) => [...current, { ...(data as TutorMessage), attachmentPreviewUrl: attachment?.signedUrl }]);
    setPendingAttachment(null);
    const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-tutor', { body: { conversation_id: conversationId, content, attachment_url: attachment?.path, attachment_type: attachment?.type } });
    if (aiError || !aiData?.message) setError('Tutor AI is unavailable; your message was saved without an automated reply.');
    else setMessages((current) => [...current, aiData.message as TutorMessage]);
    setSending(false);
  }

  async function clear() {
    if (!conversationId) return;
    const { error: deleteError } = await supabase.from('tutor_messages').delete().eq('conversation_id', conversationId);
    if (deleteError) setError('The conversation could not be cleared.'); else setMessages([]);
  }

  return <div className="space-y-6">
    {error && <div className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">{error}</div>}
    <Card className="flex h-[640px] flex-col">
      <div className="flex items-center gap-3 border-b border-ink-100 p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white"><Sparkles size={20} /></div><div className="flex-1"><h3 className="font-display font-700 text-ink-900">Tutor AI</h3><Badge tone="brand">Text, image and voice</Badge></div><button onClick={() => void clear()} disabled={!conversationId || loading} className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-danger-50"><Trash2 size={17} /></button></div>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-ink-50/40 p-4">{loading ? <Loader2 className="mx-auto animate-spin text-brand-600" /> : messages.length === 0 ? <p className="py-12 text-center text-sm text-ink-500">No messages in this session.</p> : messages.map((message) => <div key={message.id} className={`flex gap-3 ${message.role === 'student' ? 'flex-row-reverse' : ''}`}><Avatar name={message.role === 'student' ? 'You' : 'AI'} size={32} /><div className="max-w-[78%] rounded-2xl bg-white px-4 py-2.5 text-sm text-ink-800"><p>{message.content}</p>{message.attachmentPreviewUrl && message.attachment_type === 'image' && <img src={message.attachmentPreviewUrl} alt="Tutor attachment" className="mt-2 max-h-56 rounded-lg object-contain" />}{message.attachmentPreviewUrl && message.attachment_type === 'audio' && <audio controls src={message.attachmentPreviewUrl} className="mt-2 max-w-full" />}</div></div>)}</div>
      {pendingAttachment && <div className="flex items-center gap-2 border-t border-ink-100 bg-brand-50 p-2 text-xs text-brand-800"><Paperclip size={14} /> {pendingAttachment.type === 'image' ? 'Image attached' : 'Voice message attached'}<button onClick={() => setPendingAttachment(null)} className="mr-auto underline">Remove</button></div>}
      <div className="flex items-center gap-2 border-t border-ink-100 p-3"><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseImage(event)} className="hidden" /><button onClick={() => fileRef.current?.click()} disabled={loading || sending || !conversationId} className="btn-ghost" title="Attach image"><Image size={18} /></button><button onClick={() => void toggleRecording()} disabled={loading || sending || !conversationId} className={`btn-ghost ${recording ? 'text-danger-600' : ''}`} title={recording ? 'Stop recording' : 'Record voice'}>{recording ? <Square size={18} /> : <Mic size={18} />}</button><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} disabled={loading || sending || !conversationId} className="input flex-1" placeholder="Ask Tutor AI..." /><button onClick={() => void send()} disabled={loading || sending || (!input.trim() && !pendingAttachment) || !conversationId} className="btn-primary">{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></div>
    </Card>
  </div>;
}
