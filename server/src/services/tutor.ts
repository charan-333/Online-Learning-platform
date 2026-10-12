import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { many, one } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export interface GroundingDoc {
  kind: 'topic' | 'question' | 'solution' | 'error' | 'mock' | 'formula';
  id: string;
  title: string;
  text: string;
}

export interface TutorReply {
  content: string;
  provider: string;
  grounding: { kind: string; id: string; title: string }[];
  degraded?: string;
}

/**
 * Collects the platform's own verified content for the tutor's context. Solutions
 * are included only when the learner is already allowed to see them, so the tutor
 * cannot be used to bypass "answer first".
 */
export async function buildGrounding(userId: string, contextType: string, contextId: string | null): Promise<GroundingDoc[]> {
  const docs: GroundingDoc[] = [];
  const addTopic = async (topicId: string) => {
    const t = await one('SELECT id, name, summary, concept_md, traps_md FROM topics WHERE id = $1', [topicId]);
    if (t) docs.push({ kind: 'topic', id: t.id, title: t.name, text: `${t.summary}\n\n${t.concept_md}\n\nCommon traps:\n${t.traps_md}` });
    const f = await many('SELECT id, title, formula_tex, explanation_md, safe_when_md, fails_when_md FROM formula_cards WHERE topic_id = $1', [topicId]);
    for (const x of f) docs.push({ kind: 'formula', id: x.id, title: x.title, text: `$${x.formula_tex}$ — ${x.explanation_md} ${x.safe_when_md ? `Safe when: ${x.safe_when_md}` : ''} ${x.fails_when_md ? `Fails when: ${x.fails_when_md}` : ''}` });
  };
  if (!contextId) return docs;
  if (contextType === 'topic') await addTopic(contextId);
  if (contextType === 'question' || contextType === 'error') {
    let qid = contextId;
    if (contextType === 'error') {
      const e = await one('SELECT question_id, category, root_cause, learner_answer FROM error_logs WHERE id = $1 AND user_id = $2', [contextId, userId]);
      if (!e) return docs;
      qid = e.question_id;
      docs.push({ kind: 'error', id: contextId, title: 'Your logged mistake', text: `Category: ${e.category}. Your answer: ${e.learner_answer ?? '(none)'}. Notes: ${e.root_cause}` });
    }
    const q = await one("SELECT id, external_id, topic_id, stem_md, question_type, origin, exam_year, exam_slot FROM questions WHERE id = $1 AND status = 'published'", [qid]);
    if (!q) return docs;
    const opts = await many('SELECT key, text_md FROM question_options WHERE question_id = $1 ORDER BY key', [qid]);
    const origin = q.origin === 'authentic_pyq' ? `Authentic CAT ${q.exam_year}${q.exam_slot ? ` slot ${q.exam_slot}` : ''} question` : `Origin: ${q.origin.replace('_', ' ')} (not a CAT PYQ)`;
    docs.push({ kind: 'question', id: q.id, title: q.external_id, text: `${origin}\n${q.stem_md}\n${opts.map((o) => `(${o.key}) ${o.text_md}`).join('\n')}` });
    const allowed = await one(
      `SELECT EXISTS (SELECT 1 FROM question_attempts WHERE user_id = $1 AND question_id = $2) OR EXISTS (SELECT 1 FROM solution_reveals WHERE user_id = $1 AND question_id = $2) AS ok`,
      [userId, qid],
    );
    if (allowed?.ok) {
      const s = await one('SELECT * FROM question_solutions WHERE question_id = $1', [qid]);
      const ans = await one('SELECT correct_answer FROM questions WHERE id = $1', [qid]);
      if (s)
        docs.push({
          kind: 'solution',
          id: q.id,
          title: `Solution to ${q.external_id}`,
          text: `Correct answer: ${ans!.correct_answer}\n${s.learn_md}\nExam method: ${s.exam_method_md}\nCommon mistakes: ${s.common_mistakes_md}\nWhy other options fail: ${JSON.stringify(s.distractors)}`,
        });
    }
    await addTopic(q.topic_id);
  }
  if (contextType === 'mock') {
    const m = await one('SELECT ma.summary FROM mock_analysis ma JOIN mock_attempts a ON a.id = ma.attempt_id WHERE a.id = $1 AND a.user_id = $2', [contextId, userId]);
    if (m) {
      const s = m.summary;
      docs.push({
        kind: 'mock',
        id: contextId,
        title: 'Your test analysis',
        text: `Score ${s.totals.rawScore}/${s.totals.maxScore}; accuracy ${s.totals.accuracy}%; negative marks ${s.totals.negativeMarks}. Weak topics: ${s.weaknesses.join(', ') || 'none'}. Recommendations: ${s.recommendations.map((r: any) => r.text).join(' ')}`,
      });
    }
  }
  return docs;
}

/** Offline mode: answers from platform content only, with no generation. */
export function offlineReply(message: string, docs: GroundingDoc[], hintsShown: number, hints: string[]): string {
  const m = message.toLowerCase();
  const sol = docs.find((d) => d.kind === 'solution');
  const topic = docs.find((d) => d.kind === 'topic');
  if (/\bhint\b/.test(m)) {
    if (!hints.length) return 'There are no stored hints for this question.';
    const i = Math.min(hintsShown, hints.length - 1);
    return `Hint ${i + 1} of ${hints.length}: ${hints[i]}`;
  }
  if (/(why|wrong|distractor|option)/.test(m) && sol) return `From the verified solution:\n\n${sol.text}`;
  if (/(explain|solution|how)/.test(m)) {
    if (sol) return `From the verified solution:\n\n${sol.text}`;
    if (docs.some((d) => d.kind === 'question')) return 'Answer the question first (or reveal the solution) and I can walk through the full explanation.';
  }
  if (/(formula|shortcut)/.test(m)) {
    const f = docs.filter((d) => d.kind === 'formula');
    if (f.length) return f.map((x) => `**${x.title}**: ${x.text}`).join('\n\n');
  }
  if (topic) return `Here is the platform's concept summary for **${topic.title}**:\n\n${topic.text}`;
  return "The AI tutor isn't connected, so I can only show platform content. Open a topic, question, or test analysis and ask about it.";
}

const SYSTEM = `You are the CAT 100 tutor, an expert CAT (Common Admission Test) coach for QA, VARC and DILR.
Rules:
- Ground factual claims about specific questions, solutions, sources and the learner's results ONLY in the <platform_content> provided. If something is not there, say you don't have it.
- Never claim a question is an authentic CAT previous-year question or give a year/slot unless the platform content says so.
- If you are not certain an answer or step is correct, say so plainly instead of guessing.
- If you write a practice question, label it "Generated practice (not a PYQ)".
- When the learner asks for a hint, give one progressive hint and do not reveal the final answer.
- Do not reveal a question's answer unless the platform content includes its solution.
- Use $...$ for mathematics. Be concise and concrete.`;

let client: Anthropic | null = null;
export function aiEnabled() {
  return config.AI_PROVIDER === 'anthropic' && !!config.ANTHROPIC_API_KEY;
}

export async function aiReply(history: { role: 'user' | 'assistant'; content: string }[], docs: GroundingDoc[]): Promise<string> {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  const content = docs.map((d) => `<doc kind="${d.kind}" title="${d.title.replace(/"/g, "'")}">\n${d.text}\n</doc>`).join('\n');
  const response = await client.beta.messages.create({
    model: config.AI_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: `<platform_content>\n${content || '(none)'}\n</platform_content>` }],
    output_config: { effort: 'low' },
    messages: history,
  } as any);
  if (response.stop_reason === 'refusal') return "I can't help with that request. Try asking about the concept or question in a different way.";
  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty response from AI provider');
  return text;
}

export async function tutorRespond(userId: string, session: any, history: { role: 'user' | 'assistant'; content: string }[]): Promise<TutorReply> {
  const docs = await buildGrounding(userId, session.context_type, session.context_id);
  const grounding = docs.map((d) => ({ kind: d.kind, id: d.id, title: d.title }));
  const last = history[history.length - 1].content;
  let hints: string[] = [];
  const qDoc = docs.find((d) => d.kind === 'question');
  if (qDoc) hints = (await one('SELECT hints FROM question_solutions WHERE question_id = $1', [qDoc.id]))?.hints ?? [];
  const hintsShown = history.filter((h) => h.role === 'assistant' && h.content.startsWith('Hint ')).length;
  if (!aiEnabled()) {
    return { content: offlineReply(last, docs, hintsShown, hints), provider: 'offline', grounding, degraded: 'AI tutor not configured; answering from platform content only.' };
  }
  try {
    return { content: await aiReply(history, docs), provider: config.AI_MODEL, grounding };
  } catch (err) {
    logger.warn({ err }, 'tutor provider failed; using offline reply');
    return {
      content: offlineReply(last, docs, hintsShown, hints),
      provider: 'offline',
      grounding,
      degraded: 'The AI service did not respond, so this answer uses platform content only. You can keep studying and try again later.',
    };
  }
}
