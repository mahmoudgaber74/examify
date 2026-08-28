const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface GradingRequest {
  questionType: string;
  questionPrompt: string;
  studentAnswer: string;
  correctAnswer?: string;
  maxScore: number;
  rubric?: { criterion: string; weight: number; maxScore: number; keywords: string[] }[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: GradingRequest = await req.json();

    // Check if an LLM API key is configured
    const llmKey = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('ANTHROPIC_API_KEY');

    if (llmKey) {
      // Use LLM for grading
      const result = await gradeWithLLM(body, llmKey);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fall back to rule-based grading
    const result = ruleBasedGrade(body);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function ruleBasedGrade(req: GradingRequest) {
  if (req.questionType === 'short_answer' && req.correctAnswer) {
    return gradeShortAnswer(req.studentAnswer, req.correctAnswer, req.maxScore);
  }
  if (req.questionType === 'essay') {
    return gradeEssay(req.studentAnswer, req.rubric ?? [], req.maxScore);
  }
  return {
    score: 0,
    maxScore: req.maxScore,
    percentage: 0,
    confidence: 0,
    feedback: 'نوع سؤال غير مدعوم',
    rubricScores: [],
    needsReview: true,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s\u0600-\u06FF]/g, '').replace(/\s+/g, ' ');
}

function gradeShortAnswer(studentText: string, correctAnswer: string, maxScore: number) {
  const student = normalize(studentText);
  const correct = normalize(correctAnswer);
  if (!student) return { score: 0, maxScore, percentage: 0, confidence: 1, feedback: 'إجابة فارغة', rubricScores: [], needsReview: false };
  if (student === correct) return { score: maxScore, maxScore, percentage: 100, confidence: 0.95, feedback: 'إجابة صحيحة', rubricScores: [], needsReview: false };
  if (student.includes(correct) || correct.includes(student)) return { score: maxScore, maxScore, percentage: 100, confidence: 0.85, feedback: 'إجابة صحيحة', rubricScores: [], needsReview: false };
  const studentWords = new Set(student.split(' '));
  const correctWords = correct.split(' ');
  const overlap = correctWords.filter((w) => studentWords.has(w)).length;
  const ratio = correctWords.length > 0 ? overlap / correctWords.length : 0;
  if (ratio >= 0.8) return { score: maxScore, maxScore, percentage: 100, confidence: 0.75, feedback: 'إجابة صحيحة', rubricScores: [], needsReview: false };
  if (ratio >= 0.5) return { score: maxScore * 0.5, maxScore, percentage: 50, confidence: 0.6, feedback: 'إجابة جزئية', rubricScores: [], needsReview: true };
  return { score: 0, maxScore, percentage: 0, confidence: 0.7, feedback: 'إجابة خاطئة', rubricScores: [], needsReview: false };
}

function gradeEssay(studentText: string, rubric: any[], maxScore: number) {
  const wordCount = studentText.trim().split(/\s+/).length;
  const rubricScores: any[] = [];
  let totalScore = 0;
  let totalMax = 0;
  for (const item of rubric) {
    totalMax += item.maxScore;
    let score = 0;
    if (item.keywords?.length > 0) {
      const lowerText = studentText.toLowerCase();
      const found = item.keywords.filter((kw: string) => lowerText.includes(kw.toLowerCase()));
      score = Math.round(item.maxScore * (found.length / item.keywords.length) * 100) / 100;
    } else {
      score = wordCount >= 50 ? item.maxScore * 0.7 : wordCount >= 25 ? item.maxScore * 0.4 : item.maxScore * 0.15;
    }
    totalScore += score;
    rubricScores.push({ criterion: item.criterion, score, max: item.maxScore });
  }
  const effectiveMax = totalMax > 0 ? totalMax : maxScore;
  const percentage = effectiveMax > 0 ? (totalScore / effectiveMax) * 100 : 0;
  const confidence = wordCount < 10 ? 0.4 : wordCount < 50 ? 0.6 : 0.75;
  return { score: totalScore, maxScore: effectiveMax, percentage, confidence, feedback: percentage >= 70 ? 'إجابة جيدة' : 'تحتاج تطوير', rubricScores, needsReview: confidence < 0.7 };
}

async function gradeWithLLM(req: GradingRequest, apiKey: string): Promise<any> {
  const prompt = `You are an expert teacher grading a student's answer. Grade fairly and provide feedback in Arabic.

Question: ${req.questionPrompt}
Student Answer: ${req.studentAnswer}
Correct Answer: ${req.correctAnswer ?? 'N/A'}
Max Score: ${req.maxScore}

Respond in JSON format:
{"score": number, "maxScore": ${req.maxScore}, "percentage": number, "confidence": number, "feedback": "Arabic feedback", "needsReview": boolean}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) throw new Error('LLM API error');
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch {
    return ruleBasedGrade(req);
  }
}
