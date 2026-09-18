# Phase 7 Runtime Verification Checklist

Run against a disposable staging Supabase project after applying all migrations.

## Preconditions

- [ ] Apply migrations in order and inspect the effective function definitions and policies.
- [ ] Configure staging URL, anon key, service-role key only in CI secrets.
- [ ] Create two institutions, two students, staff users, a teacher-scoped exam, and authorized/unauthorized parent links.
- [ ] Confirm Edge Function secrets and deploy `whatsapp-notification`.

## Exam lifecycle

- [ ] Unassigned student cannot start an exam.
- [ ] Student cannot exceed `max_attempts`.
- [ ] Two concurrent start requests produce one in-progress attempt.
- [ ] Student A cannot read or update Student B's attempt or answers.
- [ ] Student cannot modify attempt status, score, publication, or grading metadata.
- [ ] Submission rejects malformed answers and question/option IDs from another exam.
- [ ] Repeating the same submission returns the existing final state without changing the score.
- [ ] Verify expired online submission and expired offline queued submission both finalize authoritatively.

## Grading and publication

- [ ] Teacher outside the exam scope cannot grade or publish it.
- [ ] Scores below zero or above total points are rejected.
- [ ] A submitted attempt cannot be published before grading.
- [ ] Publishing creates exactly one publication event under repeated requests.
- [ ] Unpublished attempts are invisible to students but visible to authorized staff.
- [ ] Unpublishing requires a reason and removes student visibility.
- [ ] Audit rows identify actor, institution, attempt, score, and publication transition.

## Parent notification

- [ ] Parent without `can_receive_alerts` receives no notification.
- [ ] Authorized linked parent receives one in-app notification.
- [ ] Replaying the same event does not duplicate the notification.
- [ ] Twilio success marks delivery; provider failure preserves in-app delivery and records `whatsapp_error`.
- [ ] Cross-institution staff cannot process another institution's publication event.

