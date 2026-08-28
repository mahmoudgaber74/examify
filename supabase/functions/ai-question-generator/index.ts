const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface QuestionGenRequest {
  topic: string;
  subject: string;
  difficulty: string; // easy, medium, hard
  type: string; // multiple_choice, true_false, short_answer, essay
  count: number;
  language?: string; // ar, en
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: QuestionGenRequest = await req.json();
    const llmKey = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('ANTHROPIC_API_KEY');

    if (llmKey) {
      const questions = await generateWithLLM(body, llmKey);
      return new Response(JSON.stringify({ questions, source: 'llm' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Rule-based generation
    const questions = ruleBasedGenerate(body);
    return new Response(JSON.stringify({ questions, source: 'rule-based' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function ruleBasedGenerate(req: QuestionGenRequest): any[] {
  const questions: any[] = [];
  const lang = req.language ?? 'ar';

  const templates = {
    multiple_choice: lang === 'ar' ? [
      { prompt: `أي مما يلي يعتبر من خصائص ${req.topic}؟`, options: ['الخاصية الأولى', 'الخاصية الثانية', 'الخاصية الثالثة', 'لا شيء مما سبق'], correct: 0 },
      { prompt: `ما هو التعريف الصحيح لـ ${req.topic}؟`, options: ['التعريف الأول', 'التعريف الثاني', 'التعريف الثالث', 'التعريف الرابع'], correct: 1 },
      { prompt: `في سياق ${req.subject}، ماذا يعني ${req.topic}؟`, options: ['المعنى الأول', 'المعنى الثاني', 'المعنى الثالث', 'المعنى الرابع'], correct: 2 },
    ] : [
      { prompt: `Which of the following is a characteristic of ${req.topic}?`, options: ['First property', 'Second property', 'Third property', 'None of the above'], correct: 0 },
      { prompt: `What is the correct definition of ${req.topic}?`, options: ['Definition 1', 'Definition 2', 'Definition 3', 'Definition 4'], correct: 1 },
    ],
    true_false: lang === 'ar' ? [
      { prompt: `${req.topic} يعتبر من المفاهيم الأساسية في ${req.subject}.`, correct: true },
      { prompt: `لا يوجد علاقة بين ${req.topic} و${req.subject}.`, correct: false },
    ] : [
      { prompt: `${req.topic} is a fundamental concept in ${req.subject}.`, correct: true },
      { prompt: `There is no relationship between ${req.topic} and ${req.subject}.`, correct: false },
    ],
    short_answer: lang === 'ar' ? [
      { prompt: `اشرح بإيجاز مفهوم ${req.topic} في ${req.subject}.`, correctAnswer: `${req.topic} هو مفهوم أساسي في ${req.subject} يشير إلى...` },
      { prompt: `اذكر مثالاً عملياً على ${req.topic}.`, correctAnswer: 'مثال: ...' },
    ] : [
      { prompt: `Briefly explain the concept of ${req.topic} in ${req.subject}.`, correctAnswer: `${req.topic} is a fundamental concept...` },
    ],
    essay: lang === 'ar' ? [
      { prompt: `حلّل أهمية ${req.topic} في ${req.subject} مع ذكر أمثلة عملية.`, rubric: [
        { criterion: 'وضوح الأطروحة', maxScore: 25, keywords: [] },
        { criterion: 'الأدلة والأمثلة', maxScore: 25, keywords: [] },
        { criterion: 'التحليل النقدي', maxScore: 25, keywords: [] },
        { criterion: 'البنية والأسلوب', maxScore: 25, keywords: [] },
      ] },
    ] : [
      { prompt: `Analyze the importance of ${req.topic} in ${req.subject} with examples.`, rubric: [
        { criterion: 'Thesis clarity', maxScore: 25, keywords: [] },
        { criterion: 'Evidence', maxScore: 25, keywords: [] },
        { criterion: 'Critical analysis', maxScore: 25, keywords: [] },
        { criterion: 'Structure', maxScore: 25, keywords: [] },
      ] },
    ],
  };

  const typeTemplates = templates[req.type as keyof typeof templates] ?? templates.multiple_choice;
  for (let i = 0; i < req.count; i++) {
    const template = typeTemplates[i % typeTemplates.length];
    questions.push({
      ...template,
      difficulty: req.difficulty,
      subject: req.subject,
      topic: req.topic,
    });
  }

  return questions;
}

async function generateWithLLM(req: QuestionGenRequest, apiKey: string): Promise<any[]> {
  const lang = req.language ?? 'ar';
  const langInstruction = lang === 'ar' ? 'Generate questions and options in Arabic.' : 'Generate questions and options in English.';

  const prompt = `You are an expert exam question generator. Generate ${req.count} ${req.difficulty} ${req.type} questions about "${req.topic}" in ${req.subject}. ${langInstruction}

Return JSON array where each question has:
- For multiple_choice: {"prompt": "...", "options": ["A", "B", "C", "D"], "correct": index}
- For true_false: {"prompt": "...", "correct": boolean}
- For short_answer: {"prompt": "...", "correctAnswer": "..."}
- For essay: {"prompt": "...", "rubric": [{"criterion": "...", "maxScore": number, "keywords": [...]}]}

Only return the JSON array, no other text.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!response.ok) throw new Error('LLM API error');
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch {
    return ruleBasedGenerate(req);
  }
}
