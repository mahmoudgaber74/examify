import { useState, useEffect, useRef } from 'react';
import { TUTOR_CONVERSATION, LEARNING_PATH, type TutorMessage } from '../lib/data';
import { supabase, type DbChatMessage } from '../lib/supabase';
import { Card, Badge, SectionHeader, ProgressBar, Avatar } from '../components/ui';
import {
  Sparkles, Send, Paperclip, Mic, Lightbulb, FileQuestion, PlayCircle, Map,
  CheckCircle2, Lock, Circle, Compass, BookOpen, Award, TrendingUp, Volume2, Languages,
  Trash2,
} from 'lucide-react';

const ATTACH_ICON = { flashcard: Lightbulb, quiz: FileQuestion, video: PlayCircle, plan: Map };

const TUTOR_REPLIES = [
  'سؤال ممتاز! دعني أشرّحه خطوة بخطوة. الفكرة الأساسية هنا هي فهم العلاقة بين المفاهيم. أولاً، نحدّد المتغيّرات المعروفة والمجهولة، ثم نطبّق القاعدة المناسبة. هل تريد مثالاً تطبيقياً؟',
  'فكرة جيدة! هذا المفهوم يبني على ما تعلّمناه سابقاً. لقد أنشأت بطاقات مراجعة وتمريناً قصيراً مصمّماً لمستواك الحالي. جرّبها ثم أخبرني كيف سارت.',
  'دعني أساعدك! هذا موضوع شائع يواجهه كثير من الطلاب. الحل يكمن في تقسيم المشكلة لأجزاء أصغر. أولاً، حلّل ما يُطلب. ثانياً، حدّد الأدوات المتاحة. ثالثاً، طبّق خطوة واحدة في كل مرة.',
  'إجابة جيدة جزئياً! أنت على المسار الصحيح لكن هناك نقطة واحدة تحتاج توضيحاً. لقد أنشأت شرحاً مصوّراً ومجموعة تمارين لتثبيت المفهوم.',
  'ممتاز! يبدو أنك فهمت الفكرة الأساسية. للتعمّق أكثر، أنصحك بمحاولة المسألة التالية في مسار تعلّمك. لقد أضفتها كخطوة تالية.',
];

export function Tutor() {
  const [messages, setMessages] = useState<TutorMessage[]>(TUTOR_CONVERSATION);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);

  const fetchMessages = async () => {
    const { data } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: true }).limit(20);
    if (data && data.length > 0) {
      const mapped: TutorMessage[] = (data as DbChatMessage[]).map((d) => ({
        id: d.id,
        role: d.role as 'tutor' | 'student',
        content: d.content,
        time: new Date().toLocaleTimeString(['ar'], { hour: '2-digit', minute: '2-digit' }),
        attachments: (d.attachments as TutorMessage['attachments']) ?? undefined,
      }));
      setMessages(mapped);
    }
  };

  useEffect(() => { fetchMessages(); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing]);

  const send = async () => {
    if (!input.trim() || typing) return;
    const userMsg: TutorMessage = { id: `m${Date.now()}`, role: 'student', content: input, time: new Date().toLocaleTimeString(['ar'], { hour: '2-digit', minute: '2-digit' }) };
    setMessages((m) => [...m, userMsg]);
    const sentText = input;
    setInput('');
    setTyping(true);

    await supabase.from('chat_messages').insert({ role: 'student', content: sentText });

    setTimeout(async () => {
      const replyText = TUTOR_REPLIES[Math.floor(Math.random() * TUTOR_REPLIES.length)];
      const attachments = Math.random() > 0.5
        ? [{ type: 'flashcard' as const, label: 'ملخّص المفهوم' }, { type: 'quiz' as const, label: '3 أسئلة تمارين' }]
        : undefined;
      const reply: TutorMessage = {
        id: `m${Date.now() + 1}`,
        role: 'tutor',
        content: replyText,
        time: new Date().toLocaleTimeString(['ar'], { hour: '2-digit', minute: '2-digit' }),
        attachments,
      };
      setMessages((m) => [...m, reply]);
      setTyping(false);
      await supabase.from('chat_messages').insert({ role: 'tutor', content: replyText, attachments });
    }, 1200 + Math.random() * 800);
  };

  const clearChat = async () => {
    await supabase.from('chat_messages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setMessages(TUTOR_CONVERSATION);
  };

  const speakLastReply = () => {
    const lastTutorMessage = [...messages].reverse().find((message) => message.role === 'tutor');
    if (!lastTutorMessage || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(lastTutorMessage.content));
  };

  const startVoiceInput = () => {
    const Recognition = (window as Window & { SpeechRecognition?: new () => { lang: string; start: () => void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null } }).SpeechRecognition;
    if (!Recognition) {
      setInput((current) => current || 'اكتب سؤالك هنا ثم اضغط إرسال');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'ar-EG';
    recognition.onresult = (event) => setInput(event.results[0][0].transcript);
    recognition.start();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 flex flex-col h-[640px]">
          <div className="flex items-center gap-3 p-4 border-b border-ink-100">
            <div className="grid place-items-center w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white"><Sparkles size={20} /></div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-700 text-ink-900">المعلّم الذكي</h3>
                <Badge tone="accent"><span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse-soft" /> متصل</Badge>
              </div>
              <p className="text-xs text-ink-500">شخصي · متعدد اللغات · يدعم الصوت</p>
            </div>
            <button onClick={clearChat} className="grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-danger-50 hover:text-danger-600 transition" title="مسح المحادثة"><Trash2 size={17} /></button>
            <button onClick={speakLastReply} className="grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-ink-100" title="صوت"><Volume2 size={18} /></button>
            <button onClick={() => setInput((current) => current ? `${current} (بالعربية)` : 'اشرح لي بالعربية')} className="grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-ink-100" title="لغة"><Languages size={18} /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-ink-50/40">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 animate-fade-in ${msg.role === 'student' ? 'flex-row-reverse' : ''}`}>
                <div className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${msg.role === 'tutor' ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-700'}`}>
                  {msg.role === 'tutor' ? <Sparkles size={15} /> : <Avatar name="أنت" size={32} />}
                </div>
                <div className={`max-w-[78%] flex flex-col ${msg.role === 'student' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === 'tutor' ? 'bg-white border border-ink-100 text-ink-800 rounded-tr-sm' : 'bg-brand-600 text-white rounded-tl-sm'}`}>
                    {msg.content}
                  </div>
                  {msg.attachments && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {msg.attachments.map((a, idx) => {
                        const Icon = ATTACH_ICON[a.type];
                        return (
                          <button key={idx} onClick={() => setInput(a.label)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-ink-200 text-xs font-600 text-ink-700 hover:border-brand-300 hover:bg-brand-50 transition">
                            <Icon size={13} className="text-brand-600" /> {a.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <span className="text-[10px] text-ink-400 mt-1 px-1 nums-latin">{msg.time}</span>
                </div>
              </div>
            ))}
            {typing && (
              <div className="flex gap-3 animate-fade-in">
                <div className="grid place-items-center w-8 h-8 rounded-lg shrink-0 bg-brand-600 text-white"><Sparkles size={15} /></div>
                <div className="flex items-center gap-1.5 bg-white border border-ink-100 rounded-2xl rounded-tr-sm px-4 py-3">
                  <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse-soft" />
                  <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse-soft" style={{ animationDelay: '0.2s' }} />
                  <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse-soft" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-ink-100">
            <div className="flex items-center gap-2 bg-ink-50 rounded-xl px-3 py-2">
              <button onClick={() => attachmentRef.current?.click()} className="text-ink-400 hover:text-ink-700" title="إرفاق ملف"><Paperclip size={18} /></button>
              <input ref={attachmentRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) setInput(`اشرح لي هذا الملف: ${file.name}`); }} />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="اسأل معلّمك الذكي أي شيء…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
              />
              <button onClick={startVoiceInput} className="text-ink-400 hover:text-ink-700" title="إملاء صوتي"><Mic size={18} /></button>
              <button onClick={send} disabled={typing || !input.trim()} className="grid place-items-center w-9 h-9 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"><Send size={16} /></button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionHeader title="مسار التعلّم التكيّفي" subtitle="مولّد بواسطة وكيل مدرب التعلّم" action={<Compass size={18} className="text-brand-600" />} />
            <div className="relative">
              <div className="absolute right-[15px] top-2 bottom-2 w-0.5 bg-ink-100" />
              <div className="space-y-1">
                {LEARNING_PATH.map((step) => {
                  const Icon = step.status === 'done' ? CheckCircle2 : step.status === 'active' ? Circle : Lock;
                  const tone = step.status === 'done' ? 'text-accent-600 bg-accent-50' : step.status === 'active' ? 'text-brand-600 bg-brand-50 ring-2 ring-brand-200' : 'text-ink-300 bg-ink-100';
                  return (
                    <div key={step.id} className="relative flex gap-3.5 p-2.5 rounded-xl hover:bg-ink-50 transition">
                      <div className={`grid place-items-center w-8 h-8 rounded-full shrink-0 z-10 ${tone}`}>
                        <Icon size={step.status === 'active' ? 18 : 16} />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-600 ${step.status === 'locked' ? 'text-ink-400' : 'text-ink-900'}`}>{step.title}</p>
                          {step.status === 'active' && <Badge tone="brand">الآن</Badge>}
                        </div>
                        <p className="text-[11px] text-ink-400 mt-0.5 nums-latin">{step.type} · {step.duration}</p>
                        <p className="text-xs text-ink-500 mt-1 leading-relaxed">{step.rationale}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <SectionHeader title="الأهداف الأسبوعية" />
            <div className="space-y-3">
              {[{ label: 'دروس مكتملة', value: 4, total: 6, icon: BookOpen, tone: 'brand' as const }, { label: 'مسائل تمارين', value: 18, total: 25, icon: FileQuestion, tone: 'accent' as const }, { label: 'تقييمات مجتازة', value: 2, total: 3, icon: Award, tone: 'gold' as const }].map((g) => (
                <div key={g.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-sm text-ink-700"><g.icon size={15} className="text-ink-400" /> {g.label}</span>
                    <span className="text-xs font-600 text-ink-600 nums-latin">{g.value}/{g.total}</span>
                  </div>
                  <ProgressBar value={(g.value / g.total) * 100} tone={g.tone} />
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-xl bg-accent-50 border border-accent-100 flex items-center gap-2.5">
              <TrendingUp size={18} className="text-accent-600 shrink-0" />
              <p className="text-xs text-accent-800">النتيجة المتوقّعة: تحسّن <span className="font-700 nums-latin">+6.2%</span> في التقييم القادم</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
