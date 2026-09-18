import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260924140000_class_section_scope_and_exam_visibility.sql', 'utf8');
const academicSetup = fs.readFileSync('src/views/AcademicSetup.tsx', 'utf8');
const sis = fs.readFileSync('src/views/SIS.tsx', 'utf8');

test('class section migration is additive and scope-safe', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS institution_id uuid/);
  assert.match(migration, /UPDATE public\.sections s[\s\S]*FROM public\.classes c/);
  assert.match(migration, /sections_institution_parent_name_unique/);
  assert.match(migration, /sync_section_academic_scope/);
  assert.match(migration, /sync_class_student_academic_scope/);
  assert.match(migration, /ALTER TABLE public\.sections[\s\S]*ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /institution_id = public\.current_user_institution_id\(\)/);
  assert.doesNotMatch(migration, /DELETE FROM public\.sections|TRUNCATE public\.sections|DROP TABLE public\.sections/);
});

test('section-specific student exam matching uses exact section membership', () => {
  assert.match(migration, /ea\.section_id IS NULL AND ea\.class_id IS NOT NULL AND cs\.class_id = ea\.class_id/);
  assert.match(migration, /ea\.section_id IS NOT NULL AND cs\.section_id = ea\.section_id/);
  assert.match(migration, /cs\.status = 'active'/);
});

test('academic setup exposes section CRUD under a parent class', () => {
  assert.match(academicSetup, /id: 'sections'/);
  assert.match(academicSetup, /academic-item-section/);
  assert.match(academicSetup, /academic-select-parent-class/);
  assert.match(academicSetup, /section_class_missing|لا يمكن إنشاء شعبة بدون فصل أب صالح/);
  assert.match(academicSetup, /onToggle=\{\(\) => toggle\('sections'/);
});

test('student form filters and persists academic year and section scope', () => {
  assert.match(sis, /student-academic-year/);
  assert.match(sis, /visibleSections/);
  assert.match(sis, /academic_year_id: values\.academicYearId/);
  assert.match(sis, /section_id: values\.sectionId/);
  assert.match(sis, /لا توجد شُعب نشطة لهذا الفصل/);
  assert.match(sis, /institution_id: institutionId/);
});
