// طبقة بيانات إكزاميفاي AI — معربة بالكامل
// في الإنتاج، هذه الأشكال تطابق جداول Supabase / DTOs الخدمات المصغّرة

export interface Kpi {
  id: string;
  label: string;
  value: string;
  delta: number;
  trend: number[];
  tone: 'brand' | 'accent' | 'gold' | 'danger' | 'warning';
}

export const KPIS: Kpi[] = [
  { id: 'active-learners', label: 'المتعلمون النشطون', value: '1,284,930', delta: 8.4, trend: [12, 18, 15, 22, 28, 26, 34, 41], tone: 'brand' },
  { id: 'exams-graded', label: 'امتحانات مصحّحة (30 يوم)', value: '482,117', delta: 12.1, trend: [20, 24, 22, 30, 28, 36, 44, 52], tone: 'accent' },
  { id: 'ai-confidence', label: 'ثقة التصحيح الذكي', value: '94.7%', delta: 2.3, trend: [88, 89, 90, 91, 92, 93, 94, 94.7], tone: 'gold' },
  { id: 'revenue', label: 'الإيرادات الصافية (شهرياً)', value: '4.82M$', delta: 6.8, trend: [3.1, 3.4, 3.6, 3.9, 4.2, 4.4, 4.6, 4.82], tone: 'brand' },
  { id: 'pass-rate', label: 'متوسط نسبة النجاح', value: '87.3%', delta: 1.9, trend: [82, 83, 84, 85, 85.5, 86, 86.8, 87.3], tone: 'accent' },
  { id: 'risk-students', label: 'طلاب معرّضون للخطر', value: '12,408', delta: -3.2, trend: [18, 17, 16.5, 15, 14.2, 13.5, 13, 12.4], tone: 'danger' },
];

export interface AiInsight {
  id: string;
  agent: string;
  title: string;
  detail: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  action: string;
}

export const AI_INSIGHTS: AiInsight[] = [
  {
    id: 'i1',
    agent: 'محلل أداء الطلاب',
    title: 'اكتشاف ضعف في موضوع: التفاضل والتكامل — التكامل بالأجزاء',
    detail: '1,204 طالب في 38 مؤسسة حصلوا على أقل من 55% في هذا الموضوع الفرعي خلال آخر 7 أيام. تم إنشاء مسار علاجي مقترح.',
    severity: 'warning',
    action: 'إطلاق الخطة العلاجية',
  },
  {
    id: 'i2',
    agent: 'مساعد المعلّم',
    title: '3 امتحانات بانتظار مراجعة المعلّم',
    detail: 'ثقة التصحيح الذكي أقل من الحد المسموح (82%) في أسئلة المقالة لامتحان "الاقتصاد الكلي — النهائي". بانتظار موافقة المراجع البشري.',
    severity: 'critical',
    action: 'فتح قائمة المراجعة',
  },
  {
    id: 'i3',
    agent: 'مستشار المسار المهني',
    title: 'مسار تعلّم جديد رائج: هندسة البيانات',
    detail: 'التحاق مسارات هندسة البيانات ارتفع 34% هذا الشهر. 8 مؤسسات تطلب مسار شهادات معتمد.',
    severity: 'info',
    action: 'عرض المسار',
  },
  {
    id: 'i4',
    agent: 'مدرب التعلّم',
    title: 'تم إنشاء خطة دراسة لـ 42,118 طالب',
    detail: 'تم تسليم خطط أسبوعية تكيّفية. متوسط التحسّن المتوقّع في نتيجة التقييم القادم: +6.2%.',
    severity: 'success',
    action: 'عرض نموذج خطة',
  },
];

export interface ActivityEvent {
  id: string;
  type: 'ExamCreated' | 'ExamCompleted' | 'StudentGraded' | 'CertificateGenerated' | 'PaymentCompleted' | 'AIAnalysisGenerated' | 'WeakTopicDetected' | 'StudyPlanGenerated';
  actor: string;
  detail: string;
  time: string;
}

export const ACTIVITY_FEED: ActivityEvent[] = [
  { id: 'a1', type: 'ExamCreated', actor: 'د. أميرة حسن', detail: 'أنشأت امتحان "الكيمياء العضوية — منتصف الفصل" (24 سؤال، 90 دقيقة)', time: 'قبل دقيقتين' },
  { id: 'a2', type: 'ExamCompleted', actor: 'جامعة الملك سعود', detail: '312 طالب أكملوا "هياكل البيانات — النهائي"', time: 'قبل 6 دقائق' },
  { id: 'a3', type: 'StudentGraded', actor: 'محرك التصحيح الذكي', detail: 'صحّح 1,840 تسليماً بثقة 96.2%', time: 'قبل 11 دقيقة' },
  { id: 'a4', type: 'CertificateGenerated', actor: 'محرك الشهادات', detail: 'أصدر 84 دبلوماً موثّقاً (مسجّل على البلوكشين)', time: 'قبل 18 دقيقة' },
  { id: 'a5', type: 'PaymentCompleted', actor: 'خدمة الفوترة', detail: 'تجديد الباقة المؤسسية — كلية ألغونكوين — 48,000$', time: 'قبل 24 دقيقة' },
  { id: 'a6', type: 'AIAnalysisGenerated', actor: 'خدمة التحليلات', detail: 'إعادة تدريب نموذج التنبؤ بالمخاطر التنفيذي (F1=0.91)', time: 'قبل 33 دقيقة' },
  { id: 'a7', type: 'WeakTopicDetected', actor: 'وكيل محلل الأداء', detail: 'حدّد "الجبر الخطي — القيم الذاتية" في 12 فرعاً', time: 'قبل 41 دقيقة' },
  { id: 'a8', type: 'StudyPlanGenerated', actor: 'وكيل مدرب التعلّم', detail: 'تم تسليم خرائط طريق شخصية لـ 9,402 متعلّم', time: 'قبل 52 دقيقة' },
];

export interface Exam {
  id: string;
  title: string;
  subject: string;
  questions: number;
  duration: number;
  difficulty: 'تأسيسي' | 'متوسط' | 'متقدّم' | 'خبير';
  status: 'مسودة' | 'مجدول' | 'مباشر' | 'تحت التصحيح' | 'منشور';
  enrolled: number;
  avgScore: number | null;
  aiGenerated: boolean;
  bloom: string[];
  updated: string;
}

export const EXAMS: Exam[] = [
  { id: 'e1', title: 'الكيمياء العضوية — منتصف الفصل', subject: 'الكيمياء', questions: 24, duration: 90, difficulty: 'متقدّم', status: 'مباشر', enrolled: 312, avgScore: null, aiGenerated: true, bloom: ['تطبيق', 'تحليل', 'تقييم'], updated: 'قبل دقيقتين' },
  { id: 'e2', title: 'هياكل البيانات — النهائي', subject: 'علوم الحاسب', questions: 30, duration: 120, difficulty: 'خبير', status: 'تحت التصحيح', enrolled: 410, avgScore: 78.4, aiGenerated: false, bloom: ['تطبيق', 'تحليل', 'إنشاء'], updated: 'قبل 6 دقائق' },
  { id: 'e3', title: 'التفاضل والتكامل 2 — تقنيات التكامل', subject: 'الرياضيات', questions: 18, duration: 75, difficulty: 'متوسط', status: 'منشور', enrolled: 1280, avgScore: 82.1, aiGenerated: true, bloom: ['فهم', 'تطبيق'], updated: 'قبل ساعة' },
  { id: 'e4', title: 'الاقتصاد الكلي — النهائي', subject: 'الاقتصاد', questions: 22, duration: 100, difficulty: 'متقدّم', status: 'تحت التصحيح', enrolled: 198, avgScore: 74.8, aiGenerated: false, bloom: ['تحليل', 'تقييم'], updated: 'قبل ساعتين' },
  { id: 'e5', title: 'مقدمة في الخوارزميات — اختبار 4', subject: 'علوم الحاسب', questions: 12, duration: 30, difficulty: 'تأسيسي', status: 'مجدول', enrolled: 540, avgScore: null, aiGenerated: true, bloom: ['تذكّر', 'فهم'], updated: 'قبل 3 ساعات' },
  { id: 'e6', title: 'الأدب العربي — تقييم مقالي', subject: 'الأدب', questions: 5, duration: 120, difficulty: 'متوسط', status: 'مسودة', enrolled: 0, avgScore: null, aiGenerated: true, bloom: ['تحليل', 'إنشاء'], updated: 'قبل 5 ساعات' },
];

export interface Question {
  id: string;
  type: 'اختيار من متعدد' | 'مقال' | 'برمجة' | 'رياضيات' | 'دراسة حالة' | 'سحب وإفلات' | 'صوتي' | 'محاكاة';
  prompt: string;
  topic: string;
  subtopic: string;
  difficulty: 'تأسيسي' | 'متوسط' | 'متقدّم' | 'خبير';
  bloom: string;
  successRate: number;
  aiExplanation: boolean;
  aiHints: boolean;
  learningTime: number;
}

export const QUESTIONS: Question[] = [
  { id: 'q1', type: 'اختيار من متعدد', prompt: 'أي بنية بيانات توفر إدراج وبحث بمتوسط O(1)؟', topic: 'هياكل البيانات', subtopic: 'جداول التجزئة', difficulty: 'تأسيسي', bloom: 'تذكّر', successRate: 91, aiExplanation: true, aiHints: true, learningTime: 2 },
  { id: 'q2', type: 'برمجة', prompt: 'نفّذ ذاكرة تخزين مؤقت LRU آمنة للخيوط في Java بعمليات O(1).', topic: 'التزامن', subtopic: 'التخزين المؤقت', difficulty: 'خبير', bloom: 'إنشاء', successRate: 38, aiExplanation: true, aiHints: true, learningTime: 35 },
  { id: 'q3', type: 'رياضيات', prompt: 'احسب ∫ x²·e^x dx باستخدام التكامل بالأجزاء.', topic: 'التفاضل والتكامل', subtopic: 'التكامل', difficulty: 'متوسط', bloom: 'تطبيق', successRate: 64, aiExplanation: true, aiHints: true, learningTime: 8 },
  { id: 'q4', type: 'مقال', prompt: 'حلّل تأثيرات التخفيف الكمي المستمر على الأسواق الناشئة.', topic: 'الاقتصاد', subtopic: 'السياسة النقدية', difficulty: 'متقدّم', bloom: 'تقييم', successRate: 52, aiExplanation: true, aiHints: true, learningTime: 25 },
  { id: 'q5', type: 'دراسة حالة', prompt: 'مريض 14 عاماً يعاني من ألم حاد في الصدر. شخّص واقترح خطة علاج.', topic: 'الطب', subtopic: 'أمراض القلب', difficulty: 'متقدّم', bloom: 'تحليل', successRate: 47, aiExplanation: true, aiHints: true, learningTime: 30 },
  { id: 'q6', type: 'سحب وإفلات', prompt: 'رتّب طبقات نموذج OSI بالترتيب الصحيح.', topic: 'الشبكات', subtopic: 'نموذج OSI', difficulty: 'تأسيسي', bloom: 'فهم', successRate: 88, aiExplanation: true, aiHints: true, learningTime: 3 },
  { id: 'q7', type: 'محاكاة', prompt: 'اضبط جلسة BGP بين نظامين مستقلّين.', topic: 'الشبكات', subtopic: 'التوجيه', difficulty: 'خبير', bloom: 'إنشاء', successRate: 41, aiExplanation: true, aiHints: true, learningTime: 45 },
  { id: 'q8', type: 'صوتي', prompt: 'استنسخ وحلّل عيّنة لهجة عربية منطوقة.', topic: 'اللسانيات', subtopic: 'اللهجات', difficulty: 'متوسط', bloom: 'تحليل', successRate: 71, aiExplanation: true, aiHints: true, learningTime: 6 },
];

export interface Course {
  id: string;
  title: string;
  instructor: string;
  category: string;
  lessons: number;
  duration: string;
  progress: number;
  enrolled: number;
  rating: number;
  cover: string;
  tags: string[];
}

export const COURSES: Course[] = [
  { id: 'c1', title: 'أساسيات تعلّم الآلة', instructor: 'أ.د. لينا خوري', category: 'الذكاء الاصطناعي والبيانات', lessons: 42, duration: '18س 20د', progress: 68, enrolled: 12480, rating: 4.9, cover: 'https://images.pexels.com/photos/8386440/pexels-photo-8386440.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['بايثون', 'إحصاء', 'شبكات عصبية'] },
  { id: 'c2', title: 'إتقان الكيمياء العضوية', instructor: 'د. أميرة حسن', category: 'العلوم', lessons: 36, duration: '22س 10د', progress: 34, enrolled: 8210, rating: 4.8, cover: 'https://images.pexels.com/photos/2280571/pexels-photo-2280571.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['التفاعلات', 'الآليات', 'الاصطناع'] },
  { id: 'c3', title: 'الخوارزميات المتقدّمة', instructor: 'د. عمر صالح', category: 'علوم الحاسب', lessons: 54, duration: '28س 45د', progress: 12, enrolled: 19340, rating: 4.9, cover: 'https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['الرسوم البيانية', 'البرمجة الديناميكية', 'التعقيد'] },
  { id: 'c4', title: 'الاقتصاد الكلي في الممارسة', instructor: 'أ.د. سارة تشين', category: 'إدارة الأعمال', lessons: 28, duration: '14س 30د', progress: 100, enrolled: 6720, rating: 4.7, cover: 'https://images.pexels.com/photos/534216/pexels-photo-534216.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['السياسات', 'الأسواق', 'التنبؤ'] },
  { id: 'c5', title: 'الأدب العربي والنقد', instructor: 'د. خالد منصور', category: 'العلوم الإنسانية', lessons: 24, duration: '11س 05د', progress: 0, enrolled: 4310, rating: 4.6, cover: 'https://images.pexels.com/photos/590493/pexels-photo-590493.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['الشعر', 'البلاغة', 'النقد'] },
  { id: 'c6', title: 'الرياضيات الهندسية', instructor: 'أ.د. مايا راو', category: 'الرياضيات', lessons: 48, duration: '24س 00د', progress: 56, enrolled: 9870, rating: 4.8, cover: 'https://images.pexels.com/photos/256262/pexels-photo-256262.jpeg?auto=compress&cs=tinysrgb&w=800', tags: ['التفاضل', 'الجبر الخطي', 'المعادلات التفاضلية'] },
];

export interface TutorMessage {
  id: string;
  role: 'tutor' | 'student';
  content: string;
  time: string;
  attachments?: { type: 'flashcard' | 'quiz' | 'video' | 'plan'; label: string }[];
}

export const TUTOR_CONVERSATION: TutorMessage[] = [
  {
    id: 'm1',
    role: 'student',
    content: 'أواجه صعوبة في التكامل بالأجزاء. هل يمكنك شرح متى أستخدمه؟',
    time: '10:42',
  },
  {
    id: 'm2',
    role: 'tutor',
    content: 'سؤال رائع! التكامل بالأجزاء هو الأداة المناسبة عندما تدمج جداء دالتين حيث يكون التفاضل لإحداهما سهلاً والتكامل للأخرى سهلاً. الصيغة الأساسية هي ∫u dv = uv − ∫v du. الحيلة في اختيار u و dv بحكمة — استخدم قاعدة LIATE (لوغاريتمي، عكسي مثلثي، جبري، مثلثي، أسي).',
    time: '10:42',
    attachments: [{ type: 'flashcard', label: 'مجموعة بطاقات قاعدة LIATE' }],
  },
  {
    id: 'm3',
    role: 'student',
    content: 'هل يمكنك عرض مثال ثم اختباري؟',
    time: '10:44',
  },
  {
    id: 'm4',
    role: 'tutor',
    content: 'لنحل ∫x·e^x dx معاً. حسب LIATE، u = x (جبري) و dv = e^x dx. إذن du = dx و v = e^x. بتطبيق الصيغة: ∫x·e^x dx = x·e^x − ∫e^x dx = x·e^x − e^x + C. لقد أنشأت اختباراً من 5 أسئلة لاختبار فهمك.',
    time: '10:44',
    attachments: [
      { type: 'quiz', label: 'التكامل بالأجزاء — 5 أسئلة' },
      { type: 'video', label: 'مقترح: شرح مصوّر 12 دقيقة' },
    ],
  },
];

export interface LearningPathStep {
  id: string;
  title: string;
  type: 'درس' | 'تمرين' | 'تقييم' | 'مشروع';
  status: 'done' | 'active' | 'locked';
  duration: string;
  rationale: string;
}

export const LEARNING_PATH: LearningPathStep[] = [
  { id: 'p1', title: 'مراجعة: طريقة التعويض', type: 'درس', status: 'done', duration: '15 دقيقة', rationale: 'متطلب أساسي — تم تأكيد الإتقان.' },
  { id: 'p2', title: 'مفهوم: التكامل بالأجزاء (LIATE)', type: 'درس', status: 'active', duration: '22 دقيقة', rationale: 'ضعف مكتشف — مجال التركيز الحالي.' },
  { id: 'p3', title: 'تمرين: 12 مسألة متنوعة', type: 'تمرين', status: 'locked', duration: '30 دقيقة', rationale: 'تعزيز بعد إتقان المفهوم.' },
  { id: 'p4', title: 'تقييم: التفاضل والتكامل 2 — اختبار 3', type: 'تقييم', status: 'locked', duration: '20 دقيقة', rationale: 'التحقق من الكفاءة قبل التقدّم.' },
  { id: 'p5', title: 'مشروع: نمذجة نظام فيزيائي بالتكاملات', type: 'مشروع', status: 'locked', duration: 'ساعتان', rationale: 'تطبيق التكامل على سيناريوهات واقعية.' },
];

export interface GradingSubmission {
  id: string;
  student: string;
  exam: string;
  type: 'مقال' | 'برمجة' | 'رياضيات' | 'ورقة بحثية' | 'عرض تقديمي';
  submittedAt: string;
  aiGrade: number;
  confidence: number;
  status: 'مصحّح آلياً' | 'يحتاج مراجعة' | 'تمت المراجعة';
  language?: 'EN' | 'AR';
}

export const GRADING_QUEUE: GradingSubmission[] = [
  { id: 'g1', student: 'ليلى الفارسي', exam: 'الاقتصاد الكلي — النهائي', type: 'مقال', submittedAt: 'قبل 8 دقائق', aiGrade: 84, confidence: 96, status: 'مصحّح آلياً', language: 'EN' },
  { id: 'g2', student: 'يوسف إبراهيم', exam: 'الأدب العربي — مقال', type: 'مقال', submittedAt: 'قبل 14 دقيقة', aiGrade: 78, confidence: 88, status: 'يحتاج مراجعة', language: 'AR' },
  { id: 'g3', student: 'مي لين', exam: 'هياكل البيانات — النهائي', type: 'برمجة', submittedAt: 'قبل 22 دقيقة', aiGrade: 92, confidence: 98, status: 'مصحّح آلياً' },
  { id: 'g4', student: 'كارلوس منديز', exam: 'التفاضل والتكامل 2 — اختبار', type: 'رياضيات', submittedAt: 'قبل 31 دقيقة', aiGrade: 71, confidence: 94, status: 'مصحّح آلياً' },
  { id: 'g5', student: 'عائشة رحمن', exam: 'مناهج البحث', type: 'ورقة بحثية', submittedAt: 'قبل 47 دقيقة', aiGrade: 81, confidence: 79, status: 'يحتاج مراجعة' },
  { id: 'g6', student: 'توم بيكر', exam: 'مشروع التخرّج', type: 'عرض تقديمي', submittedAt: 'قبل ساعة', aiGrade: 88, confidence: 91, status: 'تمت المراجعة' },
];

export interface RubricCriterion {
  criterion: string;
  weight: number;
  score: number;
  max: number;
  feedback: string;
}

export const RUBRIC_SAMPLE: RubricCriterion[] = [
  { criterion: 'وضوح الأطروحة والحجّة', weight: 25, score: 22, max: 25, feedback: 'أطروحة قوية قابلة للدفاع. تطوّر الحجّة منطقي وموثّق جيداً.' },
  { criterion: 'الأدلة والاستشهاد', weight: 25, score: 19, max: 25, feedback: 'مصادر ذات صلة، لكن استشهادين لا يلتزمان بتنسيق APA.' },
  { criterion: 'التحليل النقدي', weight: 25, score: 21, max: 25, feedback: 'يُظهر تحليلاً دقيقاً للحجج المضادة.' },
  { criterion: 'البنية والأسلوب', weight: 15, score: 13, max: 15, feedback: 'بنية واضحة. أخطاء نحوية بسيطة في الفقرتين 3 و 6.' },
  { criterion: 'الأصالة', weight: 10, score: 9, max: 10, feedback: 'رؤية أصلية لديناميكيات الأسواق الناشئة.' },
];

export interface CodeSubmission {
  id: string;
  student: string;
  language: 'Python' | 'Java' | 'TypeScript' | 'C++' | 'Go' | 'Rust';
  challenge: string;
  status: 'ناجح' | 'فاشل' | 'جزئي';
  testsPassed: number;
  testsTotal: number;
  runtime: string;
  memory: string;
  complexity: string;
  plagiarism: number;
}

export const CODE_SUBMISSIONS: CodeSubmission[] = [
  { id: 'cs1', student: 'مي لين', language: 'Python', challenge: 'تنفيذ ذاكرة LRU المؤقتة', status: 'ناجح', testsPassed: 12, testsTotal: 12, runtime: '38ms', memory: '14.2MB', complexity: 'O(1)', plagiarism: 4 },
  { id: 'cs2', student: 'يوسف إبراهيم', language: 'Java', challenge: 'منتج/مستهلك آمن للخيوط', status: 'جزئي', testsPassed: 8, testsTotal: 10, runtime: '52ms', memory: '28.1MB', complexity: 'O(n)', plagiarism: 12 },
  { id: 'cs3', student: 'كارلوس منديز', language: 'TypeScript', challenge: 'أقصر مسار BFS في الرسم البياني', status: 'ناجح', testsPassed: 9, testsTotal: 9, runtime: '41ms', memory: '19.8MB', complexity: 'O(V+E)', plagiarism: 2 },
  { id: 'cs4', student: 'عائشة رحمن', language: 'C++', challenge: 'مُخصّص ذاكرة Pool', status: 'فاشل', testsPassed: 4, testsTotal: 11, runtime: '—', memory: '—', complexity: '—', plagiarism: 0 },
];

export const SAMPLE_CODE = `from collections import OrderedDict
from threading import Lock

class LRUCache:
    """Thread-safe LRU cache with O(1) get/put."""
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.store: OrderedDict[int, int] = OrderedDict()
        self.lock = Lock()

    def get(self, key: int) -> int:
        with self.lock:
            if key not in self.store:
                return -1
            self.store.move_to_end(key)
            return self.store[key]

    def put(self, key: int, value: int) -> None:
        with self.lock:
            if key in self.store:
                self.store.move_to_end(key)
            self.store[key] = value
            if len(self.store) > self.capacity:
                self.store.popitem(last=False)`;

export interface Certificate {
  id: string;
  recipient: string;
  program: string;
  issuer: string;
  issued: string;
  credentialId: string;
  verified: 'بلوكشين' | 'QR' | 'قيد المراجعة';
  score: number;
}

export const CERTIFICATES: Certificate[] = [
  { id: 'cert1', recipient: 'ليلى الفارسي', program: 'تعلّم الآلة المتقدّم', issuer: 'جامعة الملك سعود', issued: '2026-06-28', credentialId: 'EXM-ML-2026-00482', verified: 'بلوكشين', score: 94 },
  { id: 'cert2', recipient: 'مي لين', program: 'هندسة الويب المتكاملة', issuer: 'معهد برلين التقني', issued: '2026-06-26', credentialId: 'EXM-FSE-2026-01120', verified: 'بلوكشين', score: 91 },
  { id: 'cert3', recipient: 'كارلوس منديز', program: 'الرياضيات الهندسية', issuer: 'UNAM', issued: '2026-06-24', credentialId: 'EXM-EM-2026-00931', verified: 'QR', score: 88 },
  { id: 'cert4', recipient: 'عائشة رحمن', program: 'الأدب العربي والنقد', issuer: 'جامعة القاهرة', issued: '2026-06-21', credentialId: 'EXM-AL-2026-00774', verified: 'بلوكشين', score: 86 },
];

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

export const MARKETPLACE: MarketplaceItem[] = [
  { id: 'mk1', title: 'بنك أسئلة كامل — AP التفاضل والتكامل BC', author: 'أكاديمية STEM التحضيرية', type: 'بنك أسئلة', price: 149, rating: 4.9, sales: 8420, cover: 'https://images.pexels.com/photos/630335/pexels-photo-630335.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'الرياضيات' },
  { id: 'mk2', title: 'معسكر هندسة الويب المتكاملة — 12 أسبوع', author: 'معهد CodeCraft', type: 'مسار تعلّم', price: 299, rating: 4.8, sales: 12100, cover: 'https://images.pexels.com/photos/270404/pexels-photo-270404.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'علوم الحاسب' },
  { id: 'mk3', title: 'حزمة قوالب امتحان — الكيمياء العضوية', author: 'د. أميرة حسن', type: 'قالب امتحان', price: 79, rating: 4.7, sales: 3210, cover: 'https://images.pexels.com/photos/2280571/pexels-photo-2280571.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'العلوم' },
  { id: 'mk4', title: 'دورة إتقان المحادثة — IELTS', author: 'Linguistics Pro', type: 'دورة', price: 89, rating: 4.9, sales: 15600, cover: 'https://images.pexels.com/photos/256417/pexels-photo-256417.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'اللغات' },
  { id: 'mk5', title: 'هياكل البيانات والخوارزميات — 500 مسألة', author: 'AlgoMasters', type: 'بنك أسئلة', price: 199, rating: 5.0, sales: 22400, cover: 'https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'علوم الحاسب' },
  { id: 'mk6', title: 'مكتبة دراسات حالة — الاقتصاد الكلي', author: 'EconEd Publishing', type: 'مورد رقمي', price: 59, rating: 4.6, sales: 1980, cover: 'https://images.pexels.com/photos/534216/pexels-photo-534216.jpeg?auto=compress&cs=tinysrgb&w=600', category: 'إدارة الأعمال' },
];

export interface Student {
  id: string;
  name: string;
  grade: string;
  institution: string;
  gpa: number;
  attendance: number;
  riskScore: number;
  status: 'على المسار' | 'معرّض للخطر' | 'متميّز' | 'تحت المراقبة';
  avatar: string;
}

export const STUDENTS: Student[] = [
  { id: 's1', name: 'ليلى الفارسي', grade: 'السنة 12', institution: 'جامعة الملك سعود', gpa: 3.92, attendance: 98, riskScore: 8, status: 'متميّز', avatar: 'https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?auto=compress&cs=tinysrgb&w=200' },
  { id: 's2', name: 'يوسف إبراهيم', grade: 'السنة 11', institution: 'جامعة القاهرة', gpa: 2.81, attendance: 76, riskScore: 64, status: 'معرّض للخطر', avatar: 'https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&w=200' },
  { id: 's3', name: 'مي لين', grade: 'السنة 13', institution: 'معهد برلين التقني', gpa: 3.78, attendance: 94, riskScore: 15, status: 'على المسار', avatar: 'https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&w=200' },
  { id: 's4', name: 'كارلوس منديز', grade: 'السنة 10', institution: 'UNAM', gpa: 3.21, attendance: 88, riskScore: 32, status: 'تحت المراقبة', avatar: 'https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=200' },
  { id: 's5', name: 'عائشة رحمن', grade: 'السنة 12', institution: 'جامعة القاهرة', gpa: 3.65, attendance: 91, riskScore: 21, status: 'على المسار', avatar: 'https://images.pexels.com/photos/762020/pexels-photo-762020.jpeg?auto=compress&cs=tinysrgb&w=200' },
  { id: 's6', name: 'توم بيكر', grade: 'السنة 13', institution: 'معهد برلين التقني', gpa: 3.88, attendance: 96, riskScore: 11, status: 'متميّز', avatar: 'https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&w=200' },
];

export interface OrgBranch {
  id: string;
  name: string;
  country: string;
  learners: number;
  revenue: string;
  health: number;
  status: 'نشط' | 'تجريبي' | 'موقوف';
}

export const BRANCHES: OrgBranch[] = [
  { id: 'b1', name: 'جامعة الملك سعود', country: 'السعودية', learners: 48200, revenue: '182k$', health: 94, status: 'نشط' },
  { id: 'b2', name: 'جامعة القاهرة', country: 'مصر', learners: 64100, revenue: '214k$', health: 88, status: 'نشط' },
  { id: 'b3', name: 'معهد برلين التقني', country: 'ألمانيا', learners: 12800, revenue: '96k$', health: 91, status: 'نشط' },
  { id: 'b4', name: 'UNAM', country: 'المكسيك', learners: 38600, revenue: '128k$', health: 79, status: 'نشط' },
  { id: 'b5', name: 'كلية ألغونكوين', country: 'كندا', learners: 9400, revenue: '48k$', health: 86, status: 'تجريبي' },
  { id: 'b6', name: 'NAM الإضافية', country: 'سنغافورة', learners: 7200, revenue: '52k$', health: 82, status: 'تجريبي' },
];

export const AI_AGENTS = [
  { name: 'مولّد الأسئلة', icon: 'FilePlus', status: 'نشط', tasks: 18420, success: 97 },
  { name: 'بنّاء الامتحانات', icon: 'ClipboardList', status: 'نشط', tasks: 9210, success: 95 },
  { name: 'مصحّح المقالات', icon: 'PenLine', status: 'نشط', tasks: 42180, success: 94 },
  { name: 'مراجع البرمجة', icon: 'Code2', status: 'نشط', tasks: 12840, success: 98 },
  { name: 'حلّال الرياضيات', icon: 'Sigma', status: 'نشط', tasks: 28940, success: 96 },
  { name: 'مدرب التعلّم', icon: 'Compass', status: 'نشط', tasks: 88200, success: 93 },
  { name: 'مستشار المسار المهني', icon: 'Briefcase', status: 'نشط', tasks: 14200, success: 91 },
  { name: 'محلل الأداء', icon: 'LineChart', status: 'نشط', tasks: 6480, success: 99 },
  { name: 'مساعد أولياء الأمور', icon: 'HeartHandshake', status: 'خامل', tasks: 3120, success: 92 },
  { name: 'مساعد المعلّم', icon: 'GraduationCap', status: 'نشط', tasks: 22100, success: 95 },
];

export const EVENT_CATALOG = [
  { name: 'ExamCreated', service: 'خدمة الامتحانات', consumers: ['التحليلات', 'الإشعارات', 'التدقيق'], frequency: 'عالي' },
  { name: 'ExamStarted', service: 'خدمة التقييم', consumers: ['التحليلات', 'التدقيق'], frequency: 'عالي' },
  { name: 'ExamCompleted', service: 'خدمة التقييم', consumers: ['التصحيح', 'التحليلات', 'الإشعارات'], frequency: 'عالي' },
  { name: 'QuestionAnswered', service: 'خدمة التقييم', consumers: ['خدمة الذكاء الاصطناعي', 'التحليلات'], frequency: 'عالٍ جداً' },
  { name: 'StudentGraded', service: 'خدمة التصحيح', consumers: ['التحليلات', 'الإشعارات', 'الشهادات'], frequency: 'عالي' },
  { name: 'CertificateGenerated', service: 'خدمة الشهادات', consumers: ['الإشعارات', 'التدقيق'], frequency: 'متوسط' },
  { name: 'PaymentCompleted', service: 'خدمة الفوترة', consumers: ['الإشعارات', 'التدقيق', 'التقارير'], frequency: 'متوسط' },
  { name: 'CourseCompleted', service: 'الخدمة الأكاديمية', consumers: ['الشهادات', 'التحليلات'], frequency: 'متوسط' },
  { name: 'AIAnalysisGenerated', service: 'خدمة الذكاء الاصطناعي', consumers: ['التحليلات', 'الإشعارات'], frequency: 'عالي' },
  { name: 'WeakTopicDetected', service: 'خدمة التحليلات', consumers: ['خدمة الذكاء الاصطناعي', 'الإشعارات'], frequency: 'متوسط' },
  { name: 'StudyPlanGenerated', service: 'خدمة الذكاء الاصطناعي', consumers: ['الإشعارات', 'نظام إدارة التعلّم'], frequency: 'عالي' },
];

export const MICROSERVICES = [
  { name: 'خدمة الهوية', db: 'PostgreSQL', status: 'سليم', uptime: 99.99, rps: 4200 },
  { name: 'خدمة المستخدمين', db: 'PostgreSQL', status: 'سليم', uptime: 99.98, rps: 3100 },
  { name: 'خدمة المؤسسات', db: 'PostgreSQL', status: 'سليم', uptime: 99.99, rps: 820 },
  { name: 'خدمة الامتحانات', db: 'PostgreSQL', status: 'سليم', uptime: 99.97, rps: 5400 },
  { name: 'خدمة التقييم', db: 'PostgreSQL', status: 'سليم', uptime: 99.96, rps: 12800 },
  { name: 'خدمة التصحيح', db: 'PostgreSQL', status: 'متأثّر', uptime: 99.42, rps: 3200 },
  { name: 'خدمة الذكاء الاصطناعي', db: 'pgvector', status: 'سليم', uptime: 99.91, rps: 8600 },
  { name: 'خدمة التحليلات', db: 'ClickHouse', status: 'سليم', uptime: 99.99, rps: 4100 },
  { name: 'خدمة الإشعارات', db: 'PostgreSQL', status: 'سليم', uptime: 99.98, rps: 2200 },
  { name: 'خدمة الفوترة', db: 'PostgreSQL', status: 'سليم', uptime: 99.99, rps: 480 },
  { name: 'خدمة الشهادات', db: 'PostgreSQL', status: 'سليم', uptime: 99.99, rps: 320 },
  { name: 'خدمة السوق', db: 'PostgreSQL', status: 'سليم', uptime: 99.97, rps: 1400 },
  { name: 'خدمة الملفات', db: 'MinIO', status: 'سليم', uptime: 99.95, rps: 6800 },
  { name: 'خدمة التدقيق', db: 'PostgreSQL', status: 'سليم', uptime: 99.99, rps: 9100 },
];
