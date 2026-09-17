/*
# Create teacher-student chat system and adaptive exam support

## Changes

### 1. New Tables: chat_conversations, chat_messages_new
- `chat_conversations`: A conversation thread between a teacher and a student within an institution.
  - `id` (uuid PK)
  - `institution_id` (uuid FK → institutions)
  - `teacher_id` (uuid FK → auth.users, the staff/teacher)
  - `student_id` (uuid FK → auth.users, the student)
  - `subject_id` (uuid FK → subjects, optional context)
  - `last_message_at` (timestamptz, for sorting)
  - `created_at` (timestamptz)
- `chat_messages_new`: Individual messages within a conversation.
  - `id` (uuid PK)
  - `conversation_id` (uuid FK → chat_conversations)
  - `sender_id` (uuid FK → auth.users)
  - `content` (text, message body)
  - `read_at` (timestamptz, nullable — when the other party read it)
  - `created_at` (timestamptz)

### 2. Modified Tables
- `examify_exams`: Added `is_adaptive` boolean column (default false) to mark exams where question difficulty adjusts based on student performance.

### 3. Security
- RLS enabled on all new tables.
- chat_conversations: Both teacher and student in the conversation can CRUD their own conversations.
- chat_messages_new: Senders can insert;
 conversation participants can SELECT/UPDATE read_at.
- All scoped to `authenticated` role with `auth.uid()` ownership checks.

### 4. Notes
- The old `chat_messages` table (from the AI tutor demo) is left untouched.
- New table is named `chat_messages_new` to avoid collision.
*/

-- ============ chat_conversations ============
CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, student_id, subject_id)
);


ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "select_own_conversations" ON chat_conversations;

CREATE POLICY "select_own_conversations"
ON chat_conversations FOR SELECT
TO authenticated USING (auth.uid() = teacher_id OR auth.uid() = student_id);


DROP POLICY IF EXISTS "insert_own_conversations" ON chat_conversations;

CREATE POLICY "insert_own_conversations"
ON chat_conversations FOR INSERT
TO authenticated WITH CHECK (auth.uid() = teacher_id OR auth.uid() = student_id);


DROP POLICY IF EXISTS "update_own_conversations" ON chat_conversations;

CREATE POLICY "update_own_conversations"
ON chat_conversations FOR UPDATE
TO authenticated USING (auth.uid() = teacher_id OR auth.uid() = student_id)
WITH CHECK (auth.uid() = teacher_id OR auth.uid() = student_id);


DROP POLICY IF EXISTS "delete_own_conversations" ON chat_conversations;

CREATE POLICY "delete_own_conversations"
ON chat_conversations FOR DELETE
TO authenticated USING (auth.uid() = teacher_id OR auth.uid() = student_id);


-- ============ chat_messages_new ============
CREATE TABLE IF NOT EXISTS chat_messages_new (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);


ALTER TABLE chat_messages_new ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "select_conversation_messages" ON chat_messages_new;

CREATE POLICY "select_conversation_messages"
ON chat_messages_new FOR SELECT
TO authenticated USING (
  EXISTS (
    SELECT 1 FROM chat_conversations c
    WHERE c.id = chat_messages_new.conversation_id
    AND (c.teacher_id = auth.uid() OR c.student_id = auth.uid())
  )
);


DROP POLICY IF EXISTS "insert_conversation_messages" ON chat_messages_new;

CREATE POLICY "insert_conversation_messages"
ON chat_messages_new FOR INSERT
TO authenticated WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM chat_conversations c
    WHERE c.id = chat_messages_new.conversation_id
    AND (c.teacher_id = auth.uid() OR c.student_id = auth.uid())
  )
);


DROP POLICY IF EXISTS "update_conversation_messages" ON chat_messages_new;

CREATE POLICY "update_conversation_messages"
ON chat_messages_new FOR UPDATE
TO authenticated USING (
  EXISTS (
    SELECT 1 FROM chat_conversations c
    WHERE c.id = chat_messages_new.conversation_id
    AND (c.teacher_id = auth.uid() OR c.student_id = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM chat_conversations c
    WHERE c.id = chat_messages_new.conversation_id
    AND (c.teacher_id = auth.uid() OR c.student_id = auth.uid())
  )
);


-- Index for conversation message lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_new_conversation ON chat_messages_new(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_participants ON chat_conversations(teacher_id, student_id);


-- ============ Adaptive exam support ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'examify_exams' AND column_name = 'is_adaptive'
  ) THEN
    ALTER TABLE examify_exams ADD COLUMN is_adaptive boolean NOT NULL DEFAULT false;

  END IF;

END $$;

;
