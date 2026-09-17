/** Static configuration only. User, product, certificate, Tutor and grading data come from the backend. */
export interface MarketplaceItem {
  id: string;
  title: string;
  author: string;
  type: 'دورة' | 'بنك أسئلة' | 'قالب امتحان' | 'مسار تعلّم' | 'مورد رقمي';
  price: number;
  rating: number;
  sales: number;
  cover: string;
  category: string;
}

export const EVENT_CATALOG = [
  { name: 'ExamCreated', service: 'خدمة الامتحانات', consumers: ['التحليلات', 'الإشعارات', 'التدقيق'], frequency: 'عالي' },
  { name: 'ExamStarted', service: 'خدمة التقييم', consumers: ['التحليلات', 'التدقيق'], frequency: 'عالي' },
  { name: 'ExamCompleted', service: 'خدمة التقييم', consumers: ['التصحيح', 'التحليلات', 'الإشعارات'], frequency: 'عالي' },
  { name: 'QuestionAnswered', service: 'خدمة التقييم', consumers: ['خدمة الذكاء الاصطناعي', 'التحليلات'], frequency: 'عالٍ جداً' },
  { name: 'StudentGraded', service: 'خدمة التصحيح', consumers: ['التحليلات', 'الإشعارات', 'الشهادات'], frequency: 'عالي' },
];

export const MICROSERVICES = [
  { name: 'خدمة الهوية', db: 'PostgreSQL', status: 'غير متاح' },
  { name: 'خدمة المؤسسات', db: 'PostgreSQL', status: 'غير متاح' },
  { name: 'خدمة الامتحانات', db: 'PostgreSQL', status: 'غير متاح' },
  { name: 'خدمة الملفات', db: 'MinIO', status: 'غير متاح' },
];
