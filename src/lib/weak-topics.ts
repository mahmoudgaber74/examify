import { supabase } from './auth-helpers';

export interface WeakTopic {
  studentId: string;
  studentName: string;
  subjectId: string;
  subjectName: string;
  topic: string;
  subtopic: string | null;
  weaknessScore: number;
  occurrences: number;
}

export interface StudyPlanItem {
  title: string;
  type: 'lesson' | 'exercise' | 'assessment' | 'project';
  durationMinutes: number;
  rationale: string;
  weakTopicId?: string;
}

export interface GeneratedStudyPlan {
  title: string;
  description: string;
  items: StudyPlanItem[];
  expectedImprovement: number;
}

export async function detectWeakTopics(institutionId: string): Promise<WeakTopic[]> {
  // Fetch all graded answers with their question metadata
  const { data: answers } = await supabase
    .from('answers')
    .select(`
      is_correct,
      awarded_points,
      questions!inner (
        id,
        unit,
        lesson,
        subject_id,
        subjects!inner (name)
      ),
      exam_attempts!inner (
        student_id,
        student_profiles!inner (full_name),
        examify_exams!inner (institution_id)
      )
    `)
    .eq('is_correct', false)
    .eq('exam_attempts.examify_exams.institution_id', institutionId)
    .not('questions.unit', 'is', null);

  const answerData = (answers as any[]) ?? [];
  const topicMap = new Map<string, WeakTopic>();

  for (const a of answerData) {
    const q = a.questions;
    const sp = a.exam_attempts?.student_profiles;
    if (!q || !sp || !q.unit) continue;

    const key = `${sp.full_name}-${q.subjects?.name}-${q.unit}`;
    const existing = topicMap.get(key);

    if (existing) {
      existing.occurrences += 1;
      existing.weaknessScore = Math.min(100, existing.weaknessScore + 15);
    } else {
      topicMap.set(key, {
        studentId: a.exam_attempts.student_id,
        studentName: sp.full_name,
        subjectId: q.subject_id,
        subjectName: q.subjects?.name ?? '',
        topic: q.unit,
        subtopic: q.lesson,
        weaknessScore: 15,
        occurrences: 1,
      });
    }
  }

  return Array.from(topicMap.values()).sort((a, b) => b.weaknessScore - a.weaknessScore);
}

export async function saveWeakTopics(institutionId: string, topics: WeakTopic[]): Promise<void> {
  const rows = topics.map((t) => ({
    institution_id: institutionId,
    student_id: t.studentId,
    subject_id: t.subjectId || null,
    topic: t.topic,
    subtopic: t.subtopic || null,
    weakness_score: t.weaknessScore,
    occurrences: t.occurrences,
  }));
  if (rows.length > 0) {
    await supabase.from('weak_topics').upsert(rows, { onConflict: 'institution_id,student_id,topic,subtopic' });
  }
}

export function generateStudyPlan(
  studentName: string,
  weakTopics: WeakTopic[]
): GeneratedStudyPlan {
  const items: StudyPlanItem[] = [];

  for (const topic of weakTopics.slice(0, 5)) {
    items.push({
      title: `مراجعة: ${topic.topic}${topic.subtopic ? ` — ${topic.subtopic}` : ''}`,
      type: 'lesson',
      durationMinutes: 20,
      rationale: `ضعف مكتشف في ${topic.subjectName} (${topic.occurrences} إجابات خاطئة)`,
      weakTopicId: undefined,
    });

    items.push({
      title: `تمارين: ${topic.topic}`,
      type: 'exercise',
      durationMinutes: 30,
      rationale: 'تعزيز بعد المراجعة',
    });

    items.push({
      title: `تقييم قصير: ${topic.topic}`,
      type: 'assessment',
      durationMinutes: 15,
      rationale: 'التحقق من الإتقان',
    });
  }

  items.push({
    title: 'تقييم شامل لجميع نقاط الضعف',
    type: 'assessment',
    durationMinutes: 45,
    rationale: 'قياس التحسن العام',
  });

  const expectedImprovement = Math.min(20, 5 + weakTopics.length * 2);

  return {
    title: `خطة دراسية تكيّفية لـ ${studentName}`,
    description: `خطة مبنية على ${weakTopics.length} نقاط ضعف مكتشفة. مدة تقديرية: ${items.reduce((s, i) => s + i.durationMinutes, 0)} دقيقة`,
    items,
    expectedImprovement,
  };
}
