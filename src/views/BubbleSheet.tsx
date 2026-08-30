import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, Loader2, AlertCircle, Download, Upload, ScanLine, Eye, Check, X, Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import { Card, SectionHeader, Badge, EmptyState } from '../components/ui';
import { supabase, useAuthSafe } from '../lib/auth-helpers';
import { generateBubbleSheetPDF, downloadBlob, type BubbleSheetSection } from '../lib/bubble-sheet';
import { scanBubbleSheet, type OmrScanResult } from '../lib/omr-scanner';

interface ExamRow { id: string; title: string; status: string; }
interface ExamSectionRow { id: string; title: string; sort_order: number; }
interface StudentRow { id: string; full_name: string; student_code: string | null; }
interface BubbleSheetRow {
  id: string;
  exam_id: string;
  model_label: string;
  questions_count: number;
  choices_count: number;
  include_student_id: boolean;
  include_student_name: boolean;
  include_qr: boolean;
  template_version: number;
  created_at: string;
  qr_token: string;
  status: string;
  sections?: BubbleSheetSection[];
}
interface OmrResultRow {
  id: string;
  exam_id: string;
  student_profile_id: string | null;
  exam_attempt_id: string | null;
  student_name: string | null;
  student_code: string | null;
  image_url: string | null;
  original_storage_path: string | null;
  processed_storage_path: string | null;
  image_mime_type: string | null;
  image_size_bytes: number | null;
  file_sha256: string | null;
  template_version: number | null;
  status: string;
  score: number;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  empty_count: number;
  confidence: number;
  processing_error: string | null;
  engine: string | null;
  engine_version: string | null;
  document_confidence: number | null;
  processing_time_ms: number | null;
  annotated_storage_path: string | null;
  warnings: string[] | null;
  created_at: string;
}

type Tab = 'generate' | 'scan' | 'results';
const OMR_BUCKET = 'exam-sheets';
const OMR_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const OMR_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OMR_TEMPLATE_VERSION = 1;

function omrFileExtension(file: File) {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'application/pdf') return 'pdf';
  return 'jpg';
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function detectOmrImageMime(file: File) {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return 'image/png';
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  const signature = new TextDecoder('ascii').decode(header);
  if (signature.startsWith('%PDF-')) return 'application/pdf';
  if (signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function validateOmrImage(file: File) {
  if (!OMR_ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'ارفع صورة بصيغة JPG أو PNG أو WebP فقط.';
  }
  if (file.size <= 0 || file.size > OMR_MAX_IMAGE_BYTES) {
    return 'حجم صورة الورقة يجب ألا يتجاوز 20MB.';
  }
  const detectedMime = await detectOmrImageMime(file);
  if (!detectedMime || detectedMime !== file.type) {
    return 'محتوى الملف لا يطابق صيغة الصورة المعلنة.';
  }
  return null;
}

function friendlyOmrError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('row-level security') || message.includes('new row violates row-level security')) {
    return 'ليست لديك صلاحية تنفيذ هذه العملية على صورة المسح.';
  }
  if (message.includes('invalid_omr_original_storage_path')) {
    return 'مسار صورة المسح غير متوافق مع الامتحان أو المؤسسة.';
  }
  if (message.includes('mime') || message.includes('MIME') || message.includes('invalid_omr_image_mime_type')) {
    return 'صيغة صورة المسح غير مسموح بها.';
  }
  if (message.includes('size') || message.includes('invalid_omr_image_size')) {
    return 'حجم صورة المسح غير مسموح به.';
  }
  if (message.includes('duplicate key') || message.includes('omr_results_exam_file_sha256_unique')) {
    return 'تم رفع نفس صورة المسح لهذا الامتحان مسبقاً. افتح النتيجة الموجودة للمراجعة.';
  }
  if (message.includes('invalid_omr_file_sha256')) {
    return 'بصمة ملف المسح غير صحيحة.';
  }
  return message || 'حدث خطأ أثناء معالجة صورة المسح.';
}

export function BubbleSheet() {
  const { institutionId, user } = useAuthSafe();
  const [tab, setTab] = useState<Tab>('generate');
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [sheets, setSheets] = useState<BubbleSheetRow[]>([]);
  const [omrResults, setOmrResults] = useState<OmrResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const loadExams = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('examify_exams')
      .select('id, title, status')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    setExams((data as ExamRow[]) ?? []);
  }, [institutionId]);

  const loadSheets = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('bubble_sheets')
      .select('id, exam_id, model_label, questions_count, choices_count, include_student_id, include_student_name, include_qr, template_version, qr_token, status, sections, created_at')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    setSheets((data as BubbleSheetRow[]) ?? []);
  }, [institutionId]);

  const loadStudents = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('student_profiles')
      .select('id, full_name, student_code')
      .eq('institution_id', institutionId)
      .eq('is_active', true)
      .order('full_name');
    setStudents((data as StudentRow[]) ?? []);
  }, [institutionId]);

  const loadOmrResults = useCallback(async () => {
    if (!institutionId) return;
    const { data } = await supabase
      .from('omr_results')
      .select('id, exam_id, student_profile_id, exam_attempt_id, student_name, student_code, image_url, original_storage_path, processed_storage_path, image_mime_type, image_size_bytes, file_sha256, template_version, status, score, total_questions, correct_count, wrong_count, empty_count, confidence, processing_error, engine, engine_version, document_confidence, processing_time_ms, annotated_storage_path, warnings, created_at')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false });
    setOmrResults((data as OmrResultRow[]) ?? []);
  }, [institutionId]);

  useEffect(() => {
    Promise.all([loadExams(), loadSheets(), loadStudents(), loadOmrResults()]).then(() => setLoading(false));
  }, [loadExams, loadSheets, loadStudents, loadOmrResults]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-brand-600" /></div>;

  return (
    <div className="space-y-5">
      <SectionHeader title="البابل شيت و OMR" subtitle="إنشاء نماذج أوراق الامتحان وتصحيحها آلياً بالكاميرا أو الماسح الضوئي" />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200">
          <AlertCircle size={18} className="text-danger-600" />
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-xl bg-ink-100">
        <button data-testid="omr-tab-generate" onClick={() => setTab('generate')} className={`flex-1 py-2.5 rounded-lg text-sm font-600 flex items-center justify-center gap-2 ${tab === 'generate' ? 'bg-white shadow-sm' : 'text-ink-500'}`}>
          <FileText size={16} /> إنشاء نموذج
        </button>
        <button data-testid="omr-tab-scan" onClick={() => setTab('scan')} className={`flex-1 py-2.5 rounded-lg text-sm font-600 flex items-center justify-center gap-2 ${tab === 'scan' ? 'bg-white shadow-sm' : 'text-ink-500'}`}>
          <ScanLine size={16} /> مسح وتصحيح
        </button>
        <button data-testid="omr-tab-results" onClick={() => setTab('results')} className={`flex-1 py-2.5 rounded-lg text-sm font-600 flex items-center justify-center gap-2 ${tab === 'results' ? 'bg-white shadow-sm' : 'text-ink-500'}`}>
          <Eye size={16} /> النتائج
        </button>
      </div>

      {tab === 'generate' && <GenerateTab exams={exams} institutionId={institutionId ?? ''} onCreated={loadSheets} />}
      {tab === 'scan' && <ScanTab exams={exams} sheets={sheets} institutionId={institutionId ?? ''} userId={user?.id ?? ''} onScanned={loadOmrResults} />}
      {tab === 'results' && <ResultsTab results={omrResults} exams={exams} students={students} onUpdated={loadOmrResults} />}
    </div>
  );
}

function GenerateTab({ exams, institutionId, onCreated }: { exams: ExamRow[]; institutionId: string; onCreated: () => void }) {
  const [examId, setExamId] = useState('');
  const [modelLabel, setModelLabel] = useState('A');
  const [questionsCount, setQuestionsCount] = useState(20);
  const [choicesCount, setChoicesCount] = useState(4);
  const [sectionsEnabled, setSectionsEnabled] = useState(false);
  const [sections, setSections] = useState<BubbleSheetSection[]>([
    { title: 'لفظي', questionsCount: 13 },
    { title: 'المفردات الشاذة', questionsCount: 16 },
    { title: 'كمي', questionsCount: 10 },
  ]);
  const [loadingExamSections, setLoadingExamSections] = useState(false);
  const [includeStudentId, setIncludeStudentId] = useState(true);
  const [includeStudentName, setIncludeStudentName] = useState(true);
  const [includeQr, setIncludeQr] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    async function loadExamStructure() {
      setLoadingExamSections(true);
      const [{ data: sectionRows }, { count }] = await Promise.all([
        supabase.from('exam_sections').select('id, title, sort_order').eq('exam_id', examId).order('sort_order').order('created_at'),
        supabase.from('exam_questions').select('id', { count: 'exact', head: true }).eq('exam_id', examId),
      ]);
      if (cancelled) return;
      const rows = (sectionRows as ExamSectionRow[]) ?? [];
      if (rows.length) {
        const { data: questionRows } = await supabase.from('exam_questions').select('section_id').eq('exam_id', examId);
        const counts = new Map<string, number>();
        for (const row of (questionRows as { section_id: string | null }[]) ?? []) {
          if (row.section_id) counts.set(row.section_id, (counts.get(row.section_id) ?? 0) + 1);
        }
        const populatedRows = rows.filter((row) => (counts.get(row.id) ?? 0) > 0);
        setSections((populatedRows.length ? populatedRows : rows).map((row) => ({ title: row.title, questionsCount: counts.get(row.id) ?? 1 })));
      } else {
        setSections([{ title: 'الأسئلة', questionsCount: count ?? 20 }]);
      }
      setLoadingExamSections(false);
    }
    loadExamStructure().catch(() => { if (!cancelled) setLoadingExamSections(false); });
    return () => { cancelled = true; };
  }, [examId]);

  function updateSection(index: number, patch: Partial<BubbleSheetSection>) {
    setSections((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setSections((items) => {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    if (!examId) { setError('اختر امتحان'); setGenerating(false); return; }
    const exam = exams.find((e) => e.id === examId);
    if (!exam) { setError('الامتحان غير موجود'); setGenerating(false); return; }
    const activeSections = sectionsEnabled ? sections.filter((section) => section.title.trim() && section.questionsCount > 0) : [];
    if (sectionsEnabled && (activeSections.length < 2 || activeSections.length > 4)) { setError('النموذج المركّب يدعم من قسمين إلى 4 أقسام.'); setGenerating(false); return; }
    if (sectionsEnabled && activeSections.some((section) => !Number.isInteger(section.questionsCount) || section.questionsCount < 1)) { setError('عدد أسئلة كل قسم يجب أن يكون رقمًا صحيحًا.'); setGenerating(false); return; }
    const totalQuestions = activeSections.reduce((sum, section) => sum + section.questionsCount, 0) || questionsCount;

    try {
      const qrToken = crypto.randomUUID();
      const blob = await generateBubbleSheetPDF({
        examId,
        examTitle: exam.title,
        modelLabel,
        questionsCount: totalQuestions,
        choicesCount,
        templateVersion: OMR_TEMPLATE_VERSION,
        includeStudentId,
        includeStudentName,
        includeQr,
        qrToken,
        pageSize: 'A4',
        sections: activeSections.length > 0 ? activeSections : undefined,
      });
      downloadBlob(blob, `bubble-sheet-${exam.title}-${modelLabel}.pdf`);

      if (sectionsEnabled) {
        const { data: existingSections, error: sectionsError } = await supabase.from('exam_sections').select('id').eq('exam_id', examId).order('sort_order').order('created_at');
        if (sectionsError) throw sectionsError;
        const existingIds = ((existingSections as { id: string }[]) ?? []).map((row) => row.id);
        const sectionIds: string[] = [];
        for (let index = 0; index < activeSections.length; index++) {
          const existingId = existingIds[index];
          if (existingId) {
            const { error: updateError } = await supabase.from('exam_sections').update({ title: activeSections[index].title.trim(), sort_order: index }).eq('id', existingId);
            if (updateError) throw updateError;
            sectionIds.push(existingId);
          } else {
            const { data: created, error: createError } = await supabase.from('exam_sections').insert({ exam_id: examId, title: activeSections[index].title.trim(), sort_order: index }).select('id').single();
            if (createError) throw createError;
            sectionIds.push((created as { id: string }).id);
          }
        }
        const { data: examQuestionRows, error: questionLoadError } = await supabase.from('exam_questions').select('id').eq('exam_id', examId).order('sort_order').order('id');
        if (questionLoadError) throw questionLoadError;
        if (((examQuestionRows as { id: string }[]) ?? []).length !== totalQuestions) throw new Error('إجمالي أسئلة الأقسام يجب أن يساوي عدد أسئلة الامتحان الفعلي.');
        let offset = 0;
        for (let index = 0; index < activeSections.length; index++) {
          const ids = ((examQuestionRows as { id: string }[]) ?? []).slice(offset, offset + activeSections[index].questionsCount).map((row) => row.id);
          if (ids.length) {
            const { error: assignError } = await supabase.from('exam_questions').update({ section_id: sectionIds[index] }).in('id', ids);
            if (assignError) throw assignError;
          }
          offset += activeSections[index].questionsCount;
        }
      }

      const { error: sheetError } = await supabase.from('bubble_sheets').insert({
        institution_id: institutionId,
        exam_id: examId,
        model_label: modelLabel,
        questions_count: totalQuestions,
        choices_count: choicesCount,
        include_student_id: includeStudentId,
        include_student_name: includeStudentName,
        include_qr: includeQr,
        template_version: OMR_TEMPLATE_VERSION,
        qr_token: qrToken,
        sections: activeSections,
        status: 'active',
        generated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
      });
      if (sheetError) throw sheetError;

      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-700 text-ink-900">إنشاء نموذج بابل شيت</h3>
      {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
      <div>
        <label className="label">الامتحان</label>
        <select data-testid="omr-exam-select" className="input" value={examId} onChange={(e) => setExamId(e.target.value)}>
          <option value="">اختر امتحان</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">النموذج</label>
          <select className="input" value={modelLabel} onChange={(e) => setModelLabel(e.target.value)}>
            {['A', 'B', 'C', 'D'].map((m) => <option key={m} value={m}>نموذج {m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">عدد الأسئلة</label>
          <input data-testid="omr-question-count" type="number" min="1" max="100" className="input" value={questionsCount} onChange={(e) => setQuestionsCount(Number(e.target.value))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">عدد الاختيارات</label>
          <input type="number" min="2" max="8" className="input" value={choicesCount} onChange={(e) => setChoicesCount(Number(e.target.value))} />
        </div>
      </div>
      <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
        <label className="flex items-center gap-2 cursor-pointer text-sm font-700 text-brand-800">
          <input type="checkbox" checked={sectionsEnabled} onChange={(e) => setSectionsEnabled(e.target.checked)} />
          إنشاء ورقة مركّبة بأقسام متعددة
        </label>
        <p className="text-xs text-brand-700 mt-1.5">الأقسام مرتبطة بالامتحان ويتم ترقيم أسئلتها تلقائيًا حسب ترتيب الأقسام. يمكنك إنشاء من قسمين إلى 4 أقسام.</p>
        {sectionsEnabled && <div className="mt-3 space-y-2">
          {sections.map((section, index) => <div key={index} className="grid grid-cols-[1fr_100px_auto] gap-2 items-center">
            <input className="input" value={section.title} onChange={(e) => setSections((items) => items.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} placeholder={`اسم القسم ${index + 1}`} aria-label={`اسم القسم ${index + 1}`} />
            <input className="input nums-latin" type="number" min="1" max="60" value={section.questionsCount} onChange={(e) => setSections((items) => items.map((item, i) => i === index ? { ...item, questionsCount: Number(e.target.value) } : item))} aria-label={`عدد أسئلة القسم ${index + 1}`} />
            <div className="flex items-center gap-1">
              <button type="button" title="تقديم" onClick={() => moveSection(index, -1)} disabled={index === 0} className="p-1 rounded border border-ink-200 disabled:opacity-30"><ChevronUp size={14} /></button>
              <button type="button" title="تأخير" onClick={() => moveSection(index, 1)} disabled={index === sections.length - 1} className="p-1 rounded border border-ink-200 disabled:opacity-30"><ChevronDown size={14} /></button>
              <button type="button" title="حذف" onClick={() => setSections((items) => items.filter((_, i) => i !== index))} disabled={sections.length <= 1} className="p-1 rounded border border-danger-200 text-danger-600 disabled:opacity-30"><Trash2 size={14} /></button>
            </div>
          </div>)}
          <button type="button" onClick={() => sections.length < 4 && setSections((items) => [...items, { title: `القسم ${items.length + 1}`, questionsCount: 10 }])} disabled={sections.length >= 4} className="btn-outline !py-1.5 text-xs"><Plus size={14} /> إضافة قسم</button>
          <p className="text-xs text-ink-500">إجمالي الأسئلة: <strong className="nums-latin">{sections.reduce((sum, section) => sum + section.questionsCount, 0)}</strong></p>
        </div>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={includeStudentId} onChange={(e) => setIncludeStudentId(e.target.checked)} /> رقم الطالب</label>
        <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={includeStudentName} onChange={(e) => setIncludeStudentName(e.target.checked)} /> اسم الطالب</label>
        <label className="flex items-center gap-2 cursor-pointer text-sm"><input type="checkbox" checked={includeQr} onChange={(e) => setIncludeQr(e.target.checked)} /> QR Code</label>
      </div>
      <button data-testid="omr-generate-template" onClick={handleGenerate} disabled={generating} className="btn-primary w-full">
        {generating ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
        توليد وتحميز PDF
      </button>
    </Card>
  );
}

function ScanTab({ exams, sheets, institutionId, userId, onScanned }: { exams: ExamRow[]; sheets: BubbleSheetRow[]; institutionId: string; userId: string; onScanned: () => void }) {
  const [engine, setEngine] = useState<'basic' | 'opencv'>('basic');
  const [examId, setExamId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<OmrScanResult | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const selectedSheet = useMemo(() => sheets.find((s) => s.exam_id === examId) ?? null, [examId, sheets]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  async function handleFileChange(nextFile: File | null) {
    setScanResult(null);
    setError(null);
    if (!nextFile) {
      setFile(null);
      return;
    }

    const validationError = await validateOmrImage(nextFile);
    if (validationError) {
      setFile(null);
      setError(validationError);
      return;
    }

    setFile(nextFile);
  }

  async function handleScan() {
    setScanning(true);
    setError(null);
    if (!file || !examId) { setError('اختر امتحان وارفع صورة'); setScanning(false); return; }

    const exam = exams.find((e) => e.id === examId);
    if (!exam) { setError('الامتحان غير موجود'); setScanning(false); return; }
    if (!institutionId || !userId) { setError('لا يمكن رفع صورة المسح قبل تسجيل الدخول وربط المستخدم بمؤسسة.'); setScanning(false); return; }
    const validationError = await validateOmrImage(file);
    if (validationError) { setError(validationError); setScanning(false); return; }
    if (file.type === 'application/pdf' && engine === 'basic') {
      setError('PDF uploaded and previewed. Basic Canvas Scanner only processes raster images; PDF rasterization is a separate service step.');
      setScanning(false);
      return;
    }
    const fileHash = await sha256Hex(file);
    const { data: duplicateRows, error: duplicateError } = await supabase
      .from('omr_results')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('exam_id', examId)
      .eq('file_sha256', fileHash)
      .limit(1);
    if (duplicateError) { setError(friendlyOmrError(duplicateError)); setScanning(false); return; }
    if ((duplicateRows ?? []).length > 0) {
      setError('تم رفع نفس صورة المسح لهذا الامتحان مسبقاً. افتح النتيجة الموجودة للمراجعة.');
      setScanning(false);
      return;
    }

    const uploadId = crypto.randomUUID();
    const storagePath = `${institutionId}/omr-original/${userId}/${examId}/${uploadId}/original.${omrFileExtension(file)}`;
    let uploaded = false;
    let insertedOmrId: string | null = null;

    try {
      const { error: uploadError } = await supabase.storage.from(OMR_BUCKET).upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { data: uploadedRow, error: uploadedError } = await supabase.from('omr_results').insert({
        institution_id: institutionId,
        bubble_sheet_id: selectedSheet?.id ?? null,
        exam_id: examId,
        image_url: null,
        original_storage_path: storagePath,
        // The legacy column is image-only; PDF identity remains in Storage metadata
        // and processing_metadata while OpenCV is the only PDF-capable path.
        image_mime_type: file.type === 'application/pdf' ? null : file.type,
        image_size_bytes: file.size,
        file_sha256: fileHash,
        template_version: selectedSheet?.template_version ?? OMR_TEMPLATE_VERSION,
        uploaded_by: userId,
        model_label: selectedSheet?.model_label ?? 'A',
        status: 'uploaded',
        total_questions: selectedSheet?.questions_count ?? 0,
        confidence: 0,
        processing_metadata: {
          scanner: 'canvas-otsu-grid-v1',
          file_name: file.name,
          detected_mime: file.type,
        },
      }).select('id').single();
      if (uploadedError) throw uploadedError;
      insertedOmrId = (uploadedRow as { id: string }).id;

      await supabase.from('omr_results').update({ status: 'processing' }).eq('id', insertedOmrId);

      // Load answer key from exam questions
      const { data: examQuestions, error: questionsError } = await supabase
        .from('exam_questions')
        .select('question_id, sort_order, points, questions!inner(id, type, prompt)')
        .eq('exam_id', examId)
        .order('sort_order');
      if (questionsError) throw questionsError;

      const eqData = (examQuestions as unknown as { question_id: string; sort_order: number; points: number; questions: { id: string; type: string } }[]) ?? [];
      const answerKey: Record<number, string> = {};
      const optionIds: Record<number, Record<string, string>> = {};

      for (let i = 0; i < eqData.length; i++) {
        const { data: opts, error: optionsError } = await supabase
          .from('question_options')
          .select('id, label, is_correct')
          .eq('question_id', eqData[i].question_id)
          .order('sort_order');
        if (optionsError) throw optionsError;
        const optionRows = (opts as { id: string; label: string; is_correct: boolean }[]) ?? [];
        optionIds[i + 1] = Object.fromEntries(optionRows.map((o) => [o.label, o.id]));
        const correctOpt = optionRows.find((o) => o.is_correct);
        if (correctOpt) answerKey[i + 1] = correctOpt.label;
      }
      setCorrectAnswers(answerKey);

      const questionsCount = selectedSheet?.questions_count ?? (eqData.length || 20);
      const choicesCount = selectedSheet?.choices_count ?? 4;
      let result: OmrScanResult;
      if (engine === 'opencv') {
        const { data: opencvData, error: opencvError } = await supabase.functions.invoke('omr-analyze', {
          body: {
            omr_result_id: insertedOmrId,
            template_id: selectedSheet?.id ?? null,
            template_version: selectedSheet?.template_version ?? OMR_TEMPLATE_VERSION,
            template_token: selectedSheet?.qr_token ?? null,
            questions_count: questionsCount,
            choices_count: choicesCount,
            columns: selectedSheet?.sections?.length ? Math.min(selectedSheet.sections.length, 4) : Math.max(1, Math.ceil(questionsCount / 25)),
            sections: selectedSheet?.sections ?? [],
          },
        });
        if (opencvError) throw opencvError;
        const response = opencvData as { job_id?: string; job_status?: string; request_id?: string; annotated_storage_path?: string | null; processing_status?: string; engine_version?: string; warnings?: string[]; questions?: { question_number: number; detected_option: string | null; confidence: number; status: string; fill_scores: Record<string, number>; warnings?: string[] }[]; document_confidence?: number };
        if (!response.job_id) throw new Error('OpenCV OMR job was not queued');
        if (!response.questions) {
          result = { answers: [], overallConfidence: 0, studentName: null, studentCode: null, engine: 'opencv', engineVersion: '0.1.0', jobId: response.job_id, processingStatus: response.job_status ?? 'queued', warnings: [], annotatedStoragePath: null };
          setScanResult(result);
          setScanning(false);
          onScanned();
          return;
        }
        result = {
          answers: response.questions.map((question) => ({
            questionNumber: question.question_number,
            detectedAnswer: question.detected_option,
            confidence: question.confidence,
            needsManualReview: ['blank', 'multiple_marks', 'low_confidence', 'unreadable', 'needs_review'].includes(question.status),
            reviewReason: question.status === 'multiple_marks' ? 'multiple_marks' : question.status === 'blank' ? 'empty' : question.status === 'low_confidence' ? 'low_confidence' : null,
            fillRatios: question.fill_scores,
          })),
          overallConfidence: response.document_confidence ?? 0,
          studentName: null,
          studentCode: null,
          engine: 'opencv',
          engineVersion: response.engine_version ?? '0.1.0',
          jobId: response.job_id ?? null,
          documentConfidence: response.document_confidence ?? 0,
          warnings: response.warnings ?? [],
          annotatedStoragePath: response.annotated_storage_path ?? null,
          processingStatus: response.processing_status,
        };
        // The Edge Function persists the job, result, and answers atomically.
        setScanResult(result);
        onScanned();
        return;
      } else {
        result = await scanBubbleSheet(file, {
          questionsCount,
          choicesCount,
          columns: selectedSheet?.sections?.length ? Math.min(selectedSheet.sections.length, 4) : Math.max(1, Math.ceil(questionsCount / 25)),
          sections: selectedSheet?.sections,
        });
      }

      setScanResult(result);

      // Save to DB
      const correctCount = result.answers.filter((a) => a.detectedAnswer && answerKey[a.questionNumber] && a.detectedAnswer === answerKey[a.questionNumber]).length;
      const wrongCount = result.answers.filter((a) => a.detectedAnswer && answerKey[a.questionNumber] && a.detectedAnswer !== answerKey[a.questionNumber]).length;
      const emptyCount = result.answers.filter((a) => !a.detectedAnswer).length;
      const reviewCount = result.answers.filter((a) => a.needsManualReview).length;

      const { error: resultError } = await supabase.from('omr_results').update({
        status: reviewCount > 0 || result.overallConfidence < 0.75 ? 'needs_review' : 'processed',
        score: correctCount,
        total_questions: result.answers.length,
        correct_count: correctCount,
        wrong_count: wrongCount,
        empty_count: emptyCount,
        confidence: result.overallConfidence,
        review_reasons: result.answers.filter((a) => a.reviewReason).map((a) => ({ question: a.questionNumber, reason: a.reviewReason })),
      }).eq('id', insertedOmrId);
      if (resultError) throw resultError;

      const answerRows = result.answers.map((a) => ({
        omr_result_id: insertedOmrId,
        question_number: a.questionNumber,
        question_id: eqData[a.questionNumber - 1]?.question_id ?? null,
        option_id: a.detectedAnswer ? optionIds[a.questionNumber]?.[a.detectedAnswer] ?? null : null,
        detected_answer: a.detectedAnswer,
        correct_answer: answerKey[a.questionNumber] ?? null,
        is_correct: a.detectedAnswer ? a.detectedAnswer === answerKey[a.questionNumber] : null,
        confidence: a.confidence,
        needs_manual_review: a.needsManualReview,
        review_reason: a.reviewReason,
        fill_ratios: a.fillRatios,
      }));
      const { error: answersError } = await supabase.from('omr_answers').insert(answerRows);
      if (answersError) throw answersError;

      onScanned();
    } catch (e) {
      if (insertedOmrId) {
        await supabase.from('omr_results').update({
          status: 'failed',
          processing_error: friendlyOmrError(e),
        }).eq('id', insertedOmrId);
      } else if (uploaded) {
        await supabase.storage.from(OMR_BUCKET).remove([storagePath]);
      }
      setError(friendlyOmrError(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 space-y-4">
        <h3 className="font-700 text-ink-900">مسح وتصحيح ورقة</h3>
        {error && <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{error}</p></div>}
        <div>
          <label className="label">محرك التصحيح</label>
          <select data-testid="omr-engine-select" className="input" value={engine} onChange={(event) => setEngine(event.target.value as 'basic' | 'opencv')}>
            <option value="opencv">OpenCV OMR Service</option>
            <option value="basic">Basic Canvas Scanner (Legacy fallback)</option>
          </select>
          {engine === 'opencv' && <p className="text-xs text-ink-400 mt-1">يعمل عبر Edge Function آمنة؛ لا يتم استدعاء خدمة OMR مباشرة من المتصفح.</p>}
        </div>
        <div>
          <label className="label">الامتحان</label>
          <select data-testid="omr-scan-exam-select" className="input" value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">اختر امتحان</option>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>
        <div>
          <label className="label">صورة الورقة</label>
          <div className="border-2 border-dashed border-ink-200 rounded-xl p-8 text-center hover:border-brand-400 transition cursor-pointer" onClick={() => document.getElementById('omr-upload')?.click()}>
            {examId && selectedSheet && (
              <p className="text-xs text-ink-400 mb-3 nums-latin">
                نموذج {selectedSheet.model_label}: {selectedSheet.questions_count} سؤال، {selectedSheet.choices_count} اختيارات
              </p>
            )}
            {examId && !selectedSheet && (
              <p className="text-xs text-warning-600 mb-3">
                لا يوجد قالب محفوظ لهذا الامتحان. سيستخدم الماسح عدد أسئلة الامتحان و4 اختيارات.
              </p>
            )}
            {file ? (
              <div className="space-y-2">
                {previewUrl && file.type === 'application/pdf' ? <iframe src={previewUrl} title="PDF preview" className="h-48 w-full rounded-lg bg-white" /> : previewUrl && <img src={previewUrl} alt="scan preview" className="max-h-48 mx-auto rounded-lg" />}
                <p className="text-sm text-ink-600">{file.name}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload size={32} className="mx-auto text-ink-400" />
                <p className="text-sm text-ink-500">اضغط لرفع صورة الورقة (JPG/PNG)</p>
              </div>
            )}
            <input id="omr-upload" data-testid="omr-upload-input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => void handleFileChange(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <button data-testid="omr-scan-submit" onClick={handleScan} disabled={scanning} className="btn-primary w-full">
          {scanning ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />}
          مسح وتصحيح
        </button>
      </Card>

      {scanResult && (
        <Card data-testid="opencv-scan-result" className="p-6">
          <h4 className="font-700 text-ink-900 mb-3">نتيجة المسح</h4>
          {scanResult.engine === 'opencv' && <div data-testid="opencv-result-metadata" className="mb-4 rounded-xl bg-brand-50 border border-brand-100 p-3 text-sm text-brand-800">OpenCV {scanResult.engineVersion ?? 'unknown'} · Job {scanResult.jobId ?? '—'} · حالة المعالجة محفوظة</div>}
          {scanResult.warnings && scanResult.warnings.length > 0 && <div className="mb-4 text-xs text-warning-700">تحذيرات: {scanResult.warnings.join('، ')}</div>}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="card-soft p-3 text-center"><div className="text-2xl font-800 text-accent-600 nums-latin">{scanResult.answers.filter((a) => a.detectedAnswer && correctAnswers[a.questionNumber] && a.detectedAnswer === correctAnswers[a.questionNumber]).length}</div><div className="text-xs text-ink-500">صحيحة</div></div>
            <div className="card-soft p-3 text-center"><div className="text-2xl font-800 text-danger-600 nums-latin">{scanResult.answers.filter((a) => a.detectedAnswer && correctAnswers[a.questionNumber] && a.detectedAnswer !== correctAnswers[a.questionNumber]).length}</div><div className="text-xs text-ink-500">خاطئة</div></div>
            <div className="card-soft p-3 text-center"><div className="text-2xl font-800 text-ink-400 nums-latin">{scanResult.answers.filter((a) => !a.detectedAnswer).length}</div><div className="text-xs text-ink-500">فارغة</div></div>
            <div className="card-soft p-3 text-center"><div className="text-2xl font-800 text-brand-600 nums-latin">{Math.round(scanResult.overallConfidence * 100)}%</div><div className="text-xs text-ink-500">الثقة</div></div>
          </div>
          <div className="card-soft p-3 mb-4 flex items-center justify-between gap-3">
            <span className="text-sm font-600 text-ink-700">إجابات تحتاج مراجعة يدوية</span>
            <Badge tone={scanResult.answers.some((a) => a.needsManualReview) ? 'warning' : 'accent'}>
              {scanResult.answers.filter((a) => a.needsManualReview).length}
            </Badge>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {scanResult.answers.map((a) => {
              const correct = correctAnswers[a.questionNumber];
              const isCorrect = a.detectedAnswer && correct && a.detectedAnswer === correct;
              return (
                <div key={a.questionNumber} className={`flex items-center gap-3 p-2 rounded-lg text-sm ${a.needsManualReview ? 'bg-warning-50' : isCorrect ? 'bg-accent-50/50' : a.detectedAnswer ? 'bg-danger-50/50' : ''}`}>
                  <span className="font-700 text-ink-500 w-8 nums-latin">{a.questionNumber}</span>
                  <span className="text-ink-700">إجابة: <b>{a.detectedAnswer ?? '—'}</b></span>
                  <span className="text-ink-400">صحيحة: {correct ?? '—'}</span>
                  <span className="text-ink-400 nums-latin">{Math.round(a.confidence * 100)}%</span>
                  {a.reviewReason && <span className="text-xs text-warning-700">{a.reviewReason}</span>}
                  {a.needsManualReview && <Badge tone="warning">مراجعة</Badge>}
                  {!a.needsManualReview && isCorrect && <Check size={14} className="text-accent-600" />}
                  {!a.needsManualReview && !isCorrect && a.detectedAnswer && <X size={14} className="text-danger-600" />}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function ResultsTab({ results, exams, students, onUpdated }: { results: OmrResultRow[]; exams: ExamRow[]; students: StudentRow[]; onUpdated: () => void }) {
  const [selected, setSelected] = useState<OmrResultRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'needs_review' | 'approved' | 'processing'>('all');
  const [answers, setAnswers] = useState<{ question_number: number; question_id: string | null; detected_answer: string | null; correct_answer: string | null; is_correct: boolean | null; needs_manual_review: boolean; manual_override: string | null; confidence: number; id: string; review_reason: string | null }[]>([]);
  const [scanImageUrl, setScanImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const reviewCount = results.filter((result) => ['needs_review', 'processed', 'pending'].includes(result.status)).length;
  const processingCount = results.filter((result) => ['uploaded', 'processing'].includes(result.status)).length;
  const approvedCount = results.filter((result) => result.status === 'approved').length;
  const visibleResults = useMemo(() => results.filter((result) => {
    if (statusFilter === 'needs_review') return ['needs_review', 'processed', 'pending'].includes(result.status);
    if (statusFilter === 'approved') return result.status === 'approved';
    if (statusFilter === 'processing') return ['uploaded', 'processing'].includes(result.status);
    return true;
  }), [results, statusFilter]);

  async function loadScanImage(path: string | null) {
    setScanImageUrl(null);
    setImageError(null);
    if (!path) {
      setImageError('لا توجد صورة محفوظة لهذه النتيجة.');
      return;
    }

    setImageLoading(true);
    const { data, error } = await supabase.storage.from(OMR_BUCKET).createSignedUrl(path, 60 * 5);
    setImageLoading(false);
    if (error) {
      setImageError(friendlyOmrError(error));
      return;
    }
    setScanImageUrl(data.signedUrl);
  }

  async function viewResult(r: OmrResultRow) {
    setSelected(r);
    setSelectedStudentId(r.student_profile_id ?? '');
    setActionError(null);
    await loadScanImage(r.annotated_storage_path ?? r.processed_storage_path ?? r.original_storage_path);
    const { data } = await supabase
      .from('omr_answers')
      .select('id, question_number, question_id, detected_answer, correct_answer, is_correct, needs_manual_review, manual_override, confidence, review_reason')
      .eq('omr_result_id', r.id)
      .order('question_number');
    setAnswers((data as typeof answers) ?? []);
  }

  async function deleteResult(r: OmrResultRow) {
    if (!confirm('هل تريد حذف نتيجة المسح؟')) return;
    const { error: dbError } = await supabase.from('omr_results').delete().eq('id', r.id);
    if (dbError) {
      alert(friendlyOmrError(dbError));
      return;
    }
    setSelected(null);
    setScanImageUrl(null);
    onUpdated();
  }

  async function overrideAnswer(answerId: string, value: string) {
    const a = answers.find((x) => x.id === answerId);
    if (!a) return;
    const manualOverride = value === 'empty' ? null : value;
    const isCorrect = manualOverride && a.correct_answer ? manualOverride === a.correct_answer : false;
    let optionId: string | null = null;
    if (manualOverride) {
      const { data: option } = await supabase
        .from('question_options')
        .select('id')
        .eq('label', manualOverride)
        .eq('question_id', a.question_id ?? '')
        .maybeSingle();
      optionId = (option as { id: string } | null)?.id ?? null;
    }
    const nextAnswers = answers.map((x) => x.id === answerId ? { ...x, manual_override: manualOverride, is_correct: isCorrect, needs_manual_review: false } : x);
    await supabase.from('omr_answers').update({ option_id: optionId, manual_override: manualOverride, is_correct: isCorrect, needs_manual_review: false, manually_reviewed_at: new Date().toISOString() }).eq('id', answerId);
    setAnswers(nextAnswers);
    if (selected) await recomputeResultStats(selected.id, nextAnswers);
  }

  async function saveDraft() {
    if (!selected) return;
    setActionLoading(true);
    setActionError(null);
    const { error } = await supabase.from('omr_results').update({
      student_profile_id: selectedStudentId || null,
      status: answers.some((a) => a.needs_manual_review) ? 'needs_review' : 'processed',
      reviewed_at: new Date().toISOString(),
    }).eq('id', selected.id);
    setActionLoading(false);
    if (error) {
      setActionError(friendlyOmrError(error));
      return;
    }
    setSelected({ ...selected, student_profile_id: selectedStudentId || null, status: answers.some((a) => a.needs_manual_review) ? 'needs_review' : 'processed' });
    onUpdated();
  }

  async function approveResult(r: OmrResultRow) {
    if (answers.some((a) => a.needs_manual_review)) {
      setActionError('يجب حل كل الإجابات التي تحتاج مراجعة قبل اعتماد الورقة.');
      return;
    }
    if (!selectedStudentId) {
      setActionError('اختر الطالب قبل اعتماد ورقة OMR.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    const { data, error } = await supabase.rpc('approve_omr_result', {
      p_omr_result_id: r.id,
      p_student_profile_id: selectedStudentId,
    });
    setActionLoading(false);
    if (error) {
      setActionError(friendlyOmrError(error));
      return;
    }
    const approved = Array.isArray(data) ? data[0] as { exam_attempt_id?: string } | undefined : undefined;
    onUpdated();
    setSelected({ ...r, status: 'approved', student_profile_id: selectedStudentId, exam_attempt_id: approved?.exam_attempt_id ?? r.exam_attempt_id });
  }

  async function recomputeResultStats(resultId: string, currentAnswers: typeof answers) {
    const correctCount = currentAnswers.filter((a) => a.is_correct === true).length;
    const wrongCount = currentAnswers.filter((a) => (a.manual_override ?? a.detected_answer) && a.is_correct === false).length;
    const emptyCount = currentAnswers.filter((a) => !(a.manual_override ?? a.detected_answer)).length;
    const reviewCount = currentAnswers.filter((a) => a.needs_manual_review).length;
    const confidence = currentAnswers.length > 0
      ? currentAnswers.reduce((sum, a) => sum + Number(a.confidence ?? 0), 0) / currentAnswers.length
      : 0;
    await supabase.from('omr_results').update({
      score: correctCount,
      correct_count: correctCount,
      wrong_count: wrongCount,
      empty_count: emptyCount,
      confidence,
      status: reviewCount > 0 ? 'needs_review' : 'processed',
    }).eq('id', resultId);
    setSelected((prev) => prev && prev.id === resultId ? {
      ...prev,
      score: correctCount,
      correct_count: correctCount,
      wrong_count: wrongCount,
      empty_count: emptyCount,
      confidence,
      status: reviewCount > 0 ? 'needs_review' : 'processed',
    } : prev);
    onUpdated();
  }

  if (selected) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setSelected(null)} className="btn-ghost">← رجوع</button>
          <div className="flex items-center gap-2">
            <button onClick={() => deleteResult(selected)} className="btn-ghost text-danger-600"><Trash2 size={16} /> حذف</button>
            <button data-testid="omr-save-draft" onClick={saveDraft} disabled={actionLoading} className="btn-outline disabled:opacity-60">حفظ المسودة</button>
            <button data-testid="omr-approve-result" onClick={() => approveResult(selected)} disabled={actionLoading || selected.status === 'approved'} className="btn-primary disabled:opacity-60"><Check size={16} /> اعتماد الورقة</button>
          </div>
        </div>
        {actionError && <div className="mb-4 flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200"><AlertCircle size={18} className="text-danger-600" /><p className="text-sm text-danger-700">{actionError}</p></div>}
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="label">الطالب</label>
            <select data-testid="omr-student-select" className="input" value={selectedStudentId} onChange={(e) => setSelectedStudentId(e.target.value)} disabled={selected.status === 'approved'}>
              <option value="">اختر الطالب للمراجعة</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>{student.full_name}{student.student_code ? ` - ${student.student_code}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">حالة المعالجة</label>
            <div data-testid="omr-review-status" className="input bg-ink-50">{selected.status}</div>
          </div>
          <div>
            <label className="label">المحاولة الحديثة</label>
            <div className="input bg-ink-50 nums-latin">{selected.exam_attempt_id ? 'مرتبطة' : 'لم تربط بعد'}</div>
          </div>
        </div>
        <div className="mb-4 rounded-xl border border-ink-100 bg-ink-50 p-3">
          {imageLoading && <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand-600" /></div>}
          {!imageLoading && imageError && <p className="text-sm text-warning-700">{imageError}</p>}
          {!imageLoading && scanImageUrl && <img data-testid="omr-review-image" src={scanImageUrl} alt="صورة ورقة المسح" className="max-h-80 w-full object-contain rounded-lg bg-white" />}
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="card-soft p-3 text-center"><div className="text-xl font-800 text-accent-600 nums-latin">{selected.correct_count}</div><div className="text-xs text-ink-500">صحيحة</div></div>
          <div className="card-soft p-3 text-center"><div className="text-xl font-800 text-danger-600 nums-latin">{selected.wrong_count}</div><div className="text-xs text-ink-500">خاطئة</div></div>
          <div className="card-soft p-3 text-center"><div className="text-xl font-800 text-ink-400 nums-latin">{selected.empty_count}</div><div className="text-xs text-ink-500">فارغة</div></div>
          <div className="card-soft p-3 text-center"><div className="text-xl font-800 text-brand-600 nums-latin">{Math.round(selected.confidence * 100)}%</div><div className="text-xs text-ink-500">الثقة</div></div>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {answers.map((a) => {
            return (
              <div key={a.id} className={`flex items-center gap-3 p-2 rounded-lg text-sm ${a.needs_manual_review ? 'bg-warning-50' : a.is_correct ? 'bg-accent-50/50' : 'bg-danger-50/50'}`}>
                <span className="font-700 text-ink-500 w-8 nums-latin">{a.question_number}</span>
                <span className="text-ink-700">المقرؤة: <b>{a.detected_answer ?? '—'}</b></span>
                <span className="text-ink-400">الصحيحة: {a.correct_answer ?? '—'}</span>
                <span className="text-ink-400 nums-latin">{Math.round(Number(a.confidence ?? 0) * 100)}%</span>
                {selected.status !== 'approved' && (
                  <select data-testid="omr-answer-override" className="input !py-1 !px-2 !w-auto text-xs mr-auto" defaultValue="" onChange={(e) => { if (e.target.value) overrideAnswer(a.id, e.target.value); }}>
                    <option value="">تعديل...</option>
                    {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((o) => <option key={o} value={o}>{o}</option>)}
                    <option value="empty">فارغة</option>
                  </select>
                )}
                {a.review_reason && <span className="text-xs text-warning-700">{a.review_reason}</span>}
                {a.manual_override && <Badge tone="brand">معدّلة: {a.manual_override}</Badge>}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  if (results.length === 0) {
    return <Card><EmptyState icon={<ScanLine size={40} />} title="لا توجد نتائج مسح" subtitle="امسح أول ورقة من تبويب المسح" /></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <button type="button" onClick={() => setStatusFilter('needs_review')} className={`card p-3 text-right transition ${statusFilter === 'needs_review' ? 'ring-2 ring-warning-300' : 'hover:border-warning-300'}`}>
          <p className="text-xs text-ink-500">تحتاج مراجعة</p><p className="mt-1 text-xl font-800 text-warning-600 nums-latin">{reviewCount}</p>
        </button>
        <button type="button" onClick={() => setStatusFilter('processing')} className={`card p-3 text-right transition ${statusFilter === 'processing' ? 'ring-2 ring-brand-300' : 'hover:border-brand-300'}`}>
          <p className="text-xs text-ink-500">قيد المعالجة</p><p className="mt-1 text-xl font-800 text-brand-600 nums-latin">{processingCount}</p>
        </button>
        <button type="button" onClick={() => setStatusFilter('approved')} className={`card p-3 text-right transition ${statusFilter === 'approved' ? 'ring-2 ring-accent-300' : 'hover:border-accent-300'}`}>
          <p className="text-xs text-ink-500">معتمدة</p><p className="mt-1 text-xl font-800 text-accent-600 nums-latin">{approvedCount}</p>
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">عرض {visibleResults.length} من {results.length} نتيجة</p>
        {statusFilter !== 'all' && <button type="button" onClick={() => setStatusFilter('all')} className="text-sm font-700 text-brand-600 hover:text-brand-700">عرض الكل</button>}
      </div>
      {visibleResults.length === 0 ? <Card><EmptyState icon={<AlertCircle size={40} />} title="لا توجد نتائج في هذا التصنيف" subtitle="اختر تصنيفًا آخر لعرض باقي الأوراق." /></Card> : <div className="grid gap-3">
      {visibleResults.map((r) => {
        const exam = exams.find((e) => e.id === r.exam_id);
        return (
          <Card key={r.id} hover className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-700 text-ink-900 truncate">{exam?.title ?? 'امتحان'}</h3>
                <div className="flex items-center gap-3 text-xs text-ink-400 mt-1">
                  {r.student_name && <span>{r.student_name}</span>}
                  <span className="nums-latin">{r.correct_count}/{r.total_questions}</span>
                  <span>· {Math.round(r.confidence * 100)}% ثقة</span>
                  <span>· {new Date(r.created_at).toLocaleString('ar')}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.status === 'uploaded' && <Badge tone="neutral">مرفوعة</Badge>}
                {r.status === 'processing' && <Badge tone="brand">قيد المعالجة</Badge>}
                {r.status === 'processed' && <Badge tone="warning">جاهزة للمراجعة</Badge>}
                {r.status === 'pending' && <Badge tone="warning">بانتظار المراجعة</Badge>}
                {r.status === 'approved' && <Badge tone="accent">معتمد</Badge>}
                {r.status === 'needs_review' && <Badge tone="danger">تحتاج مراجعة</Badge>}
                {r.status === 'failed' && <Badge tone="danger">فشلت</Badge>}
                <button data-testid="omr-view-result" onClick={() => viewResult(r)} className="btn-ghost !py-1.5 !px-3 text-xs"><Eye size={14} /> عرض</button>
              </div>
            </div>
          </Card>
        );
      })}
      </div>}
    </div>
  );
}
