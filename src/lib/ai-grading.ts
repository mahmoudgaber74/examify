import { supabase } from './auth';

export interface GradingRubric { criterion: string; weight: number; maxScore: number; keywords: string[]; }
export interface AiGradeResult { score: number; maxScore: number; percentage: number; confidence: number; feedback: string; rubricScores: { criterion: string; score: number; max: number; feedback?: string }[]; needsReview: boolean; }
export interface GradingRequest { questionType: string; questionPrompt: string; studentAnswer: string; correctAnswer?: string; maxScore: number; rubric?: GradingRubric[]; }

export async function gradeWithAi(request: GradingRequest): Promise<AiGradeResult> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-grading`;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Authentication required');
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(request) });
  if (!response.ok) throw new Error(response.status === 503 ? 'AI service unavailable' : 'AI grading request failed');
  const data = await response.json();
  if (!data || typeof data.score !== 'number') throw new Error('AI service unavailable');
  return data as AiGradeResult;
}
