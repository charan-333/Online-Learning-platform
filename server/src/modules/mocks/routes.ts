import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { parseBody, uuidParam } from '../../lib/validate.js';
import { learnerPattern } from '../../services/examConfigs.js';
import { attemptState, createTest, nextSection, saveResponse, startOrResume, submit } from '../../services/mocks.js';

export const mocksRouter = Router();

mocksRouter.get('/', async (req, res) => {
  const uid = userId(req);
  const tests = await many(
    `SELECT t.id, t.title, t.kind, t.sectional_lock, t.description, t.created_at, t.owner_id IS NULL AS platform,
            (SELECT count(*) FROM mock_test_questions mq JOIN mock_test_sections s ON s.id = mq.mock_test_section_id WHERE s.mock_test_id = t.id) AS question_count,
            (SELECT sum(duration_sec) FROM mock_test_sections s WHERE s.mock_test_id = t.id) AS duration_sec,
            (SELECT json_agg(s.section_id ORDER BY s.position) FROM mock_test_sections s WHERE s.mock_test_id = t.id) AS sections,
            c.name AS pattern_name, c.version AS pattern_version, c.verification_status AS pattern_status
       FROM mock_tests t LEFT JOIN exam_configs c ON c.id = t.exam_config_id WHERE t.owner_id IS NULL OR t.owner_id = $1 ORDER BY t.owner_id IS NULL DESC, t.created_at DESC LIMIT 100`,
    [uid],
  );
  const attempts = await many(
    `SELECT a.id, a.mock_test_id, a.status, a.started_at, a.submitted_at, a.raw_score, t.title, t.kind,
            (ma.summary->'totals'->>'maxScore')::numeric AS max_score
       FROM mock_attempts a JOIN mock_tests t ON t.id = a.mock_test_id LEFT JOIN mock_analysis ma ON ma.attempt_id = a.id
      WHERE a.user_id = $1 ORDER BY a.started_at DESC LIMIT 100`,
    [uid],
  );
  res.json({ tests, attempts });
});

/** The exam pattern new tests use, its verification status, and whether it matches the learner's exam year. */
mocksRouter.get('/pattern', async (req, res) => {
  res.json(await learnerPattern(userId(req)));
});

mocksRouter.post('/', async (req, res) => {
  const b = parseBody(
    z.object({
      kind: z.enum(['full', 'sectional', 'topic', 'custom', 'pyq_paper', 'error_test', 'drill']),
      title: z.string().trim().min(1).max(120).optional(),
      sections: z.array(z.enum(['VARC', 'DILR', 'QA'])).max(3).optional(),
      topics: z.array(z.string().max(100)).max(50).optional(),
      difficulty: z.array(z.enum(['easy', 'medium', 'difficult', 'advanced'])).optional(),
      origin: z.array(z.enum(['authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated'])).optional(),
      year: z.number().int().optional(),
      slot: z.number().int().min(1).max(3).optional(),
      questionCount: z.number().int().min(1).max(100).optional(),
      durationMin: z.number().int().min(1).max(240).optional(),
    }),
    req,
  );
  res.status(201).json(await createTest(userId(req), b));
});

mocksRouter.post('/:id/start', async (req, res) => {
  const attemptId = await startOrResume(userId(req), uuidParam(req));
  res.status(201).json(await attemptState(userId(req), attemptId));
});

mocksRouter.get('/attempts/:attemptId', async (req, res) => {
  res.json(await attemptState(userId(req), uuidParam(req, 'attemptId')));
});

mocksRouter.put('/attempts/:attemptId/responses/:questionId', async (req, res) => {
  const b = parseBody(
    z.object({ answer: z.string().max(50).nullable().optional(), flagged: z.boolean().optional(), timeSpentSec: z.number().int().min(0).max(3600).optional() }),
    req,
  );
  res.json(await saveResponse(userId(req), uuidParam(req, 'attemptId'), uuidParam(req, 'questionId'), b));
});

mocksRouter.post('/attempts/:attemptId/next-section', async (req, res) => {
  res.json(await nextSection(userId(req), uuidParam(req, 'attemptId')));
});

mocksRouter.post('/attempts/:attemptId/submit', async (req, res) => {
  res.json(await submit(userId(req), uuidParam(req, 'attemptId')));
});

mocksRouter.get('/attempts/:attemptId/analysis', async (req, res) => {
  const id = uuidParam(req, 'attemptId');
  const row = await one(
    `SELECT a.id, a.status, a.raw_score, a.submitted_at, a.submit_reason, t.title, t.kind, ma.summary FROM mock_attempts a
       JOIN mock_tests t ON t.id = a.mock_test_id LEFT JOIN mock_analysis ma ON ma.attempt_id = a.id WHERE a.id = $1 AND a.user_id = $2`,
    [id, userId(req)],
  );
  if (!row) throw notFound('Test attempt');
  if (row.status !== 'submitted') throw notFound('Analysis (submit the test first)');
  res.json(row);
});
