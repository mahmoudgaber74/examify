export interface GradingRubric {
  criterion: string;
  weight: number;
  maxScore: number;
  keywords: string[];
}

export interface AiGradeResult {
  score: number;
  maxScore: number;
  percentage: number;
  confidence: number;
  feedback: string;
  rubricScores: { criterion: string; score: number; max: number; feedback: string }[];
  needsReview: boolean;
}

export function gradeShortAnswer(studentText: string, correctAnswer: string, maxScore: number = 1): AiGradeResult {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\w\s\u0600-\u06FF]/g, '').replace(/\s+/g, ' ');
  const student = normalize(studentText);
  const correct = normalize(correctAnswer);

  if (!student) {
    return { score: 0, maxScore, percentage: 0, confidence: 1, feedback: 'إجابة فارغة', rubricScores: [], needsReview: false };
  }

  if (student === correct) {
    return { score: maxScore, maxScore, percentage: 100, confidence: 0.95, feedback: 'إجابة صحيحة تماماً', rubricScores: [], needsReview: false };
  }

  // Fuzzy match — check if correct answer is contained within student answer or vice versa
  if (student.includes(correct) || correct.includes(student)) {
    return { score: maxScore, maxScore, percentage: 100, confidence: 0.85, feedback: 'إجابة صحيحة (تطابق جزئي)', rubricScores: [], needsReview: false };
  }

  // Word overlap
  const studentWords = new Set(student.split(' '));
  const correctWords = correct.split(' ');
  const overlap = correctWords.filter((w) => studentWords.has(w)).length;
  const overlapRatio = correctWords.length > 0 ? overlap / correctWords.length : 0;

  if (overlapRatio >= 0.8) {
    return { score: maxScore, maxScore, percentage: 100, confidence: 0.75, feedback: 'إجابة صحيحة (تطابق كلمات)', rubricScores: [], needsReview: false };
  } else if (overlapRatio >= 0.5) {
    return { score: maxScore * 0.5, maxScore, percentage: 50, confidence: 0.6, feedback: 'إجابة جزئية — تحتاج مراجعة', rubricScores: [], needsReview: true };
  }

  return { score: 0, maxScore, percentage: 0, confidence: 0.7, feedback: 'إجابة خاطئة', rubricScores: [], needsReview: false };
}

export function gradeEssay(
  studentText: string,
  rubric: GradingRubric[],
  minWords: number = 50
): AiGradeResult {
  const wordCount = studentText.trim().split(/\s+/).length;
  const rubricScores: { criterion: string; score: number; max: number; feedback: string }[] = [];
  let totalScore = 0;
  let totalMax = 0;

  for (const item of rubric) {
    totalMax += item.maxScore;
    let score = 0;
    const feedback: string[] = [];

    if (item.keywords.length > 0) {
      const lowerText = studentText.toLowerCase();
      const found = item.keywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
      const ratio = found.length / item.keywords.length;
      score = Math.round(item.maxScore * ratio * 100) / 100;

      if (ratio === 0) feedback.push('لم يتم تناول النقاط المطلوبة');
      else if (ratio < 0.5) feedback.push(`تناول ${found.length} من ${item.keywords.length} نقاط رئيسية`);
      else if (ratio < 1) feedback.push(`تناول معظم النقاط (${found.length}/${item.keywords.length})`);
      else feedback.push('تناول جميع النقاط الرئيسية');
    } else {
      // No keywords — grade by length and structure
      if (wordCount >= minWords) score = item.maxScore * 0.7;
      else if (wordCount >= minWords / 2) score = item.maxScore * 0.4;
      else score = item.maxScore * 0.15;
      feedback.push(wordCount >= minWords ? 'طول مناسب' : `قصير جداً (${wordCount} كلمة، المطلوب ${minWords})`);
    }

    totalScore += score;
    rubricScores.push({ criterion: item.criterion, score, max: item.maxScore, feedback: feedback.join(' — ') });
  }

  const percentage = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  const confidence = wordCount < 10 ? 0.4 : wordCount < minWords ? 0.6 : 0.75;
  const needsReview = confidence < 0.7 || percentage < 40;

  const overallFeedback = generateEssayFeedback(percentage, wordCount, minWords);

  return {
    score: Math.round(totalScore * 100) / 100,
    maxScore: totalMax,
    percentage: Math.round(percentage * 100) / 100,
    confidence,
    feedback: overallFeedback,
    rubricScores,
    needsReview,
  };
}

function generateEssayFeedback(percentage: number, wordCount: number, minWords: number): string {
  const parts: string[] = [];
  if (percentage >= 85) parts.push('إجابة ممتازة تظهر فهماً عميقاً للموضوع');
  else if (percentage >= 70) parts.push('إجابة جيدة مع بعض النقاط الناقصة');
  else if (percentage >= 50) parts.push('إجابة مقبولة تحتاج إلى تطوير');
  else parts.push('إجابة ضعيفة تحتاج إلى مراجعة شاملة');

  if (wordCount < minWords) parts.push(`الإجابة قصيرة (${wordCount} كلمة)`);
  return parts.join(' — ');
}

export interface GradingRequest {
  questionType: string;
  questionPrompt: string;
  studentAnswer: string;
  correctAnswer?: string;
  maxScore: number;
  rubric?: GradingRubric[];
}

export async function gradeWithAi(request: GradingRequest): Promise<AiGradeResult> {
  // Try edge function first (if LLM key is configured)
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-grading`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    };
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.score !== undefined) return data as AiGradeResult;
    }
  } catch {
    // Fall through to rule-based
  }

  // Rule-based grading
  if (request.questionType === 'short_answer' && request.correctAnswer) {
    return gradeShortAnswer(request.studentAnswer, request.correctAnswer, request.maxScore);
  }
  if (request.questionType === 'essay' && request.rubric) {
    return gradeEssay(request.studentAnswer, request.rubric);
  }
  if (request.questionType === 'essay') {
    // Simple rubric if none provided
    return gradeEssay(request.studentAnswer, [
      { criterion: 'المحتوى والأفكار', weight: 40, maxScore: request.maxScore * 0.4, keywords: [] },
      { criterion: 'التنظيم والبنية', weight: 30, maxScore: request.maxScore * 0.3, keywords: [] },
      { criterion: 'اللغة والأسلوب', weight: 30, maxScore: request.maxScore * 0.3, keywords: [] },
    ]);
  }

  return { score: 0, maxScore: request.maxScore, percentage: 0, confidence: 0, feedback: 'نوع سؤال غير مدعوم', rubricScores: [], needsReview: true };
}
