-- Read-only historical OMR invariant audit. Run against a disposable/local DB.
-- No cleanup is performed by this script.

\set ON_ERROR_STOP on

WITH objective AS (
  SELECT q.id, q.type, count(qo.id)::integer AS option_count,
         count(*) FILTER (WHERE qo.is_correct IS TRUE)::integer AS correct_count,
         count(qo.sort_order)::integer AS ordered_count,
         count(DISTINCT qo.sort_order)::integer AS distinct_order_count
  FROM public.questions q
  LEFT JOIN public.question_options qo ON qo.question_id = q.id
  WHERE q.type IN ('multiple_choice', 'true_false')
  GROUP BY q.id, q.type
), classified AS (
  SELECT *, CASE
    WHEN option_count < 2 OR correct_count <> 1 THEN 'INVALID PRODUCT INVARIANT'
    WHEN option_count > 8 OR ordered_count <> distinct_order_count THEN 'VALID QUESTION BANK BUT NOT OMR COMPATIBLE'
    ELSE 'VALID'
  END AS classification
  FROM objective
)
SELECT id AS question_id, type, option_count, correct_count,
       ordered_count, distinct_order_count, classification
FROM classified
WHERE classification <> 'VALID'
ORDER BY classification, id;

SELECT 'summary' AS report, classification, count(*)::integer AS question_count
FROM (
  SELECT CASE
    WHEN count(qo.id) < 2 OR count(*) FILTER (WHERE qo.is_correct IS TRUE) <> 1 THEN 'INVALID PRODUCT INVARIANT'
    WHEN count(qo.id) > 8 OR count(qo.sort_order) <> count(DISTINCT qo.sort_order) THEN 'VALID QUESTION BANK BUT NOT OMR COMPATIBLE'
    ELSE 'VALID'
  END AS classification
  FROM public.questions q
  LEFT JOIN public.question_options qo ON qo.question_id = q.id
  WHERE q.type IN ('multiple_choice', 'true_false')
  GROUP BY q.id
) findings
GROUP BY classification
ORDER BY classification;
