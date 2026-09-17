import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const rate = new Map<string, { count: number; reset: number }>();
function cors(req: Request) { const origin = req.headers.get('Origin'); const localOrigin = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ''; return { 'Access-Control-Allow-Origin': origin && (allowedOrigins.includes(origin) || localOrigin) ? origin : (allowedOrigins[0] ?? ''), Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey' }; }
function reply(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } }); }
function rateLimited(id: string) { const now = Date.now(); const current = rate.get(id); if (!current || current.reset < now) { rate.set(id, { count: 1, reset: now + 60_000 }); return false; } current.count += 1; return current.count > 20; }
interface QuestionGenRequest { topic: string; subject: string; difficulty: string; type: string; count: number; language?: string; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return reply(req, { error: 'Authentication required' }, 401);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply(req, { error: 'Authentication failed' }, 401);
    if (rateLimited(auth.user.id)) return reply(req, { error: 'Rate limit exceeded' }, 429);
    const { data: staff } = await admin.from('staff_profiles').select('role, is_active').eq('user_id', auth.user.id).maybeSingle();
    if (!staff?.is_active || !['super_admin', 'school_admin', 'teacher', 'grader'].includes(staff.role)) return reply(req, { error: 'Not authorized' }, 403);
    const body: QuestionGenRequest = await req.json();
    if (!body || typeof body.topic !== 'string' || body.topic.length < 1 || body.topic.length > 500 || typeof body.subject !== 'string' || body.subject.length < 1 || body.subject.length > 200 || !['easy', 'medium', 'hard'].includes(body.difficulty) || !['multiple_choice', 'true_false', 'short_answer', 'essay'].includes(body.type) || !Number.isInteger(body.count) || body.count < 1 || body.count > 20 || !['ar', 'en'].includes(body.language ?? 'ar')) return reply(req, { error: 'Invalid request' }, 400);
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return reply(req, { error: 'AI service unavailable' }, 503);
    return reply(req, { questions: await generateWithLLM(body, apiKey), source: 'llm' });
  } catch { return reply(req, { error: 'AI service unavailable' }, 503); }
});

async function generateWithLLM(req: QuestionGenRequest, apiKey: string): Promise<unknown[]> {
  const language = req.language === 'en' ? 'English' : 'Arabic';
  const prompt = `Generate ${req.count} ${req.difficulty} ${req.type} questions about "${req.topic}" in ${req.subject} in ${language}. Return only a JSON array. Each item must contain a prompt and fields appropriate for its type.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7 }) });
    if (!response.ok) throw new Error('LLM API error');
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? 'null');
    if (!Array.isArray(parsed) || parsed.length !== req.count || parsed.some((question) => !question || typeof question.prompt !== 'string')) throw new Error('Invalid model response');
    return parsed;
  } finally { clearTimeout(timeout); }
}
