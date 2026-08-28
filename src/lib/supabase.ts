export { supabase } from './auth';

export interface DbStudent {
  id: string;
  name: string;
  grade: string;
  institution: string;
  gpa: number;
  attendance: number;
  risk_score: number;
  status: string;
  avatar_url: string | null;
}

export interface DbExam {
  id: string;
  title: string;
  subject: string;
  questions_count: number;
  duration: number;
  difficulty: string;
  status: string;
  enrolled: number;
  avg_score: number | null;
  ai_generated: boolean;
  bloom_levels: string[];
}

export interface DbCertificate {
  id: string;
  recipient: string;
  program: string;
  issuer: string;
  issued_date: string | null;
  credential_id: string;
  verified_method: string;
  score: number;
}

export interface DbCourse {
  id: string;
  title: string;
  instructor: string;
  category: string;
  lessons_count: number;
  duration: string;
  progress: number;
  enrolled: number;
  rating: number;
  cover_url: string | null;
  tags: string[];
}

export interface DbSubmission {
  id: string;
  student_name: string;
  exam_title: string;
  type: string;
  ai_grade: number;
  confidence: number;
  status: string;
  language: string | null;
  feedback: string | null;
}

export interface DbChatMessage {
  id: string;
  role: string;
  content: string;
  attachments: { type: string; label: string }[] | null;
}

export interface DbCartItem {
  id: string;
  item_id: string;
  title: string;
  price: number;
  cover_url: string | null;
  type: string;
}
