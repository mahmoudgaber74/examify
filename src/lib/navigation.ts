import {
  LayoutDashboard,
  FileCheck2,
  Brain,
  GraduationCap,
  Code2,
  Sigma,
  BarChart3,
  Award,
  Store,
  Users,
  Settings,
  Sparkles,
  BookOpen,
  ShieldCheck,
  Heart,
  Building2,
  Library,
  ClipboardList,
  FileText,
  TrendingUp,
  ScanLine,
  Activity,
  Cpu,
  Layers3,
  type LucideIcon,
} from 'lucide-react';

export type ViewId =
  | 'dashboard'
  | 'assessment'
  | 'tutor'
  | 'grading'
  | 'lms'
  | 'programming'
  | 'math'
  | 'analytics'
  | 'certification'
  | 'marketplace'
  | 'sis'
  | 'parents'
  | 'settings'
  | 'questionbank'
  | 'exambuilder'
  | 'examrunner'
  | 'examresults'
  | 'institutions'
  | 'academicsetup'
  | 'bubblesheet'
  | 'omrops'
  | 'reports'
  | 'aiengine';

export interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  group: 'نظرة عامة' | 'التعلّم' | 'التقييم' | 'الذكاء' | 'العمليات' | 'الإدارة';
  badge?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, group: 'نظرة عامة' },
  { id: 'analytics', label: 'التحليلات وذكاء الأعمال', icon: BarChart3, group: 'نظرة عامة' },
  { id: 'lms', label: 'إدارة التعلّم', icon: BookOpen, group: 'التعلّم' },
  { id: 'tutor', label: 'المعلّم الذكي', icon: Sparkles, group: 'التعلّم', badge: 'ذكاء' },
  { id: 'assessment', label: 'منصّة التقييم', icon: FileCheck2, group: 'التقييم' },
  { id: 'questionbank', label: 'بنك الأسئلة', icon: Library, group: 'التقييم' },
  { id: 'exambuilder', label: 'منشئ الامتحانات', icon: ClipboardList, group: 'التقييم' },
  { id: 'examrunner', label: 'الامتحانات', icon: FileText, group: 'التقييم' },
  { id: 'examresults', label: 'النتائج', icon: TrendingUp, group: 'التقييم' },
  { id: 'bubblesheet', label: 'البابل شيت و OMR', icon: ScanLine, group: 'التقييم' },
  { id: 'omrops', label: 'OMR Operations', icon: Activity, group: 'التقييم' },
  { id: 'reports', label: 'التقارير', icon: BarChart3, group: 'التقييم' },
  { id: 'aiengine', label: 'محرك الذكاء الاصطناعي', icon: Cpu, group: 'الذكاء', badge: 'ذكاء' },
  { id: 'programming', label: 'محرك البرمجة', icon: Code2, group: 'الذكاء' },
  { id: 'math', label: 'محرك الرياضيات', icon: Sigma, group: 'الذكاء' },
  { id: 'grading', label: 'محرك التصحيح الذكي', icon: Brain, group: 'الذكاء', badge: 'ذكاء' },
  { id: 'certification', label: 'الشهادات', icon: Award, group: 'العمليات' },
  { id: 'marketplace', label: 'السوق', icon: Store, group: 'العمليات' },
  { id: 'sis', label: 'نظام معلومات الطلاب', icon: Users, group: 'العمليات' },
  { id: 'parents', label: 'بوابة أولياء الأمور', icon: Heart, group: 'العمليات' },
  { id: 'institutions', label: 'إدارة المؤسسات', icon: Building2, group: 'الإدارة' },
  { id: 'academicsetup', label: 'الإعداد الأكاديمي', icon: Layers3, group: 'الإدارة' },
  { id: 'settings', label: 'المؤسسة', icon: Settings, group: 'الإدارة' },
];

export const GROUP_ORDER: NavItem['group'][] = [
  'نظرة عامة',
  'التعلّم',
  'التقييم',
  'الذكاء',
  'العمليات',
  'الإدارة',
];

export const UNUSED_ICONS: LucideIcon[] = [GraduationCap, ShieldCheck];
