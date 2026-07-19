/** Question bank helpers — shared by store + seed (no circular imports). */

/** Strip leading list numbers: "2. A. LLC" â†’ "A. LLC", "1. Whichâ€¦?" â†’ "Whichâ€¦?" */
export function stripLeadingItemNumber(prompt) {
  return String(prompt ?? '')
    .replace(/^\s*\d+\s*[\.\)\-:]\s+/, '')
    .trim();
}

/**
 * If a prompt is only an MC choice ("A. LLC", "2. B) Corporation"), return { letter, text }.
 * Used to fix tests where each option was saved as its own free-response question.
 */
export function parseStandaloneOptionPrompt(prompt) {
  const t = stripLeadingItemNumber(prompt);
  if (!t) return null;
  let m = t.match(/^([A-Da-d])\s*[\)\.\:\-]\s+(.+)$/);
  if (m) return { letter: m[1].toUpperCase(), text: m[2].trim() };
  m = t.match(/^\(([A-Da-d])\)\s+(.+)$/);
  if (m) return { letter: m[1].toUpperCase(), text: m[2].trim() };
  return null;
}

/**
 * Merge a flat list of "stem + A + B + C + D as separate questions" into real MC items.
 * Example broken bank:
 *   1. Which structure has least liability protection?
 *   2. A. LLC
 *   3. B. Corporation
 *   4. C. Sole Proprietorship
 *   5. D. Nonprofit
 * â†’ one question with four options.
 */
export function coalesceSplitMcQuestions(questions, quizId = 'q') {
  if (!Array.isArray(questions) || !questions.length) return [];
  const out = [];
  for (const q of questions) {
    if (!q) continue;
    const opt = parseStandaloneOptionPrompt(q.prompt);
    const last = out[out.length - 1];
    // Attach A/B/C/D lines onto the previous stem
    if (opt && last) {
      if (!Array.isArray(last.options)) last.options = [];
      // Avoid duplicating if already structured
      if (!last.options.includes(opt.text)) last.options.push(opt.text);
      continue;
    }
    const prompt = stripLeadingItemNumber(q.prompt);
    if (!prompt) continue;
    const next = {
      id: q.id || `${quizId}-${out.length + 1}`,
      prompt,
    };
    if (Array.isArray(q.options) && q.options.length >= 2) {
      next.options = q.options.map((o) => String(o).trim()).filter(Boolean);
      if (q.correctIndex != null && q.correctIndex !== '') next.correctIndex = Number(q.correctIndex);
    }
    out.push(next);
  }
  // Stable sequential ids for the repaired bank
  return out.map((q, i) => ({
    ...q,
    id: `${quizId}-${i + 1}`,
  }));
}

/** Normalize free-response / auto question rows into a stable {id,prompt,...} shape. */
export function normalizeQuestions(quizId, raw) {
  if (!Array.isArray(raw)) return [];
  // If the whole bank is one multi-line string joined, parse it
  if (raw.length === 1 && typeof raw[0] === 'string' && /\n/.test(raw[0])) {
    return parseQuestionBank(raw[0]).map((pq, i) => ({
      id: `${quizId || 'q'}-${i + 1}`,
      prompt: pq.prompt,
      ...(pq.options?.length ? { options: pq.options } : {}),
      ...(pq.correctIndex != null ? { correctIndex: pq.correctIndex } : {}),
    }));
  }
  const mapped = raw
    .map((q, i) => {
      if (typeof q === 'string') {
        // May be a multi-line block with A/B/C/D options
        const parsed = parseQuestionBank(q);
        if (parsed.length === 1) {
          return { id: `${quizId || 'q'}-${i + 1}`, ...parsed[0] };
        }
        const prompt = q.trim();
        if (!prompt) return null;
        return { id: `${quizId || 'q'}-${i + 1}`, prompt };
      }
      if (!q || typeof q !== 'object') return null;
      const prompt = String(q.prompt ?? q.text ?? q.question ?? '').trim();
      if (!prompt) return null;
      const id = String(q.id || `${quizId || 'q'}-${i + 1}`);
      const out = { id, prompt };
      let options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : null;
      // Choices sometimes arrive as "a,b,c,d" or "A) â€¦ B) â€¦" in a single field
      if ((!options || !options.length) && (q.choices || q.answers || q.optionsText)) {
        options = parseOptionsBlob(q.choices || q.answers || q.optionsText);
      }
      if (options?.length) {
        out.options = options;
        if (q.correctIndex != null && q.correctIndex !== '') {
          out.correctIndex = Number(q.correctIndex);
        } else if (q.correct != null || q.answer != null || q.key != null) {
          const ci = letterToIndex(q.correct ?? q.answer ?? q.key, options.length);
          if (ci != null) out.correctIndex = ci;
        }
      }
      return out;
    })
    .filter(Boolean);
  // Fix tests where each A/B/C/D line was stored as its own question (Week 2 case)
  return coalesceSplitMcQuestions(mapped, quizId || 'q');
}

/** Aâ†’0, Bâ†’1, â€¦ or 1â†’0 based numbering */
export function letterToIndex(letter, optionCount = 26) {
  if (letter == null || letter === '') return null;
  const s = String(letter).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // 1-based if looks like 1..n, else 0-based
    if (n >= 1 && n <= optionCount) return n - 1;
    if (n >= 0 && n < optionCount) return n;
    return null;
  }
  const ch = s.replace(/[^A-Za-z]/g, '').charAt(0);
  if (!ch) return null;
  const idx = ch.toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx >= optionCount) return null;
  return idx;
}

export function indexToLetter(i) {
  if (i == null || !Number.isFinite(Number(i)) || Number(i) < 0) return '';
  return String.fromCharCode(65 + Number(i));
}

/** Parse "a) foo, b) bar" or "a,b,c,d" or lines of A. / A) options. */
export function parseOptionsBlob(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  // Multi-line options
  if (/\n/.test(text)) {
    const opts = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^\s*(?:\(?([A-Da-d])\)|[A-Da-d]|[1-9])[\)\.\:\-\s]\s*(.+)$/);
      if (m) opts.push((m[2] || m[1] || '').trim());
      else if (line.trim()) opts.push(line.trim());
    }
    return opts.filter(Boolean);
  }
  // Single line: A) x  B) y  or a) x, b) y
  const labeled = [...text.matchAll(/(?:^|[\s,;])(?:\(?([A-Da-d])\)|([A-Da-d]))[\)\.\:\-]\s*([^,;]+)/gi)];
  if (labeled.length >= 2) {
    return labeled.map((m) => String(m[3] || '').trim()).filter(Boolean);
  }
  // Bare "a, b, c, d" â†’ treat each segment as option text (or letter-only labels)
  if (text.includes(',')) {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^[A-Da-d][\)\.\:\-\s]+/i, '').trim() || s);
  }
  return [];
}

/**
 * Parse admin question bank text into structured questions.
 *
 * Free-response:
 *   What is a growth mindset?
 *
 * Multiple choice (options follow the question):
 *   What is a growth mindset?
 *   A. Believing skills improve with practice
 *   B. Talent is fixed
 *   C. Avoid hard work
 *   D. Ignore feedback
 *   Correct: A
 *
 * Also accepts a) / A) / 1. labels and blank-line separators.
 */
export function parseQuestionBank(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const questions = [];
  let cur = null;

  const optionLine = (t) => {
    // A. text | A) text | (A) text | a - text | 1. text
    let m = t.match(/^\s*([A-Da-d])\s*[\)\.\:\-]\s+(.+)$/);
    if (m) return { letter: m[1].toUpperCase(), text: m[2].trim() };
    m = t.match(/^\s*\(([A-Da-d])\)\s+(.+)$/);
    if (m) return { letter: m[1].toUpperCase(), text: m[2].trim() };
    m = t.match(/^\s*([1-9])\s*[\)\.\:\-]\s+(.+)$/);
    if (m) return { letter: indexToLetter(Number(m[1]) - 1) || m[1], text: m[2].trim() };
    return null;
  };
  const correctLine = (t) => {
    let m = t.match(/^\s*(?:correct|answer|key)\s*[:=]\s*\**\s*([A-Da-d1-9])\s*\**\s*$/i);
    if (m) return m[1];
    m = t.match(/^\s*\*\s*([A-Da-d1-9])\s*$/);
    if (m) return m[1];
    return null;
  };

  const flush = () => {
    if (!cur?.prompt) {
      cur = null;
      return;
    }
    const q = { prompt: cur.prompt };
    if (cur.options?.length >= 2) {
      q.options = cur.options;
      if (cur.correctLetter != null) {
        const ci = letterToIndex(cur.correctLetter, cur.options.length);
        if (ci != null) q.correctIndex = ci;
      }
    }
    questions.push(q);
    cur = null;
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      // Blank line ends a multiple-choice block (keeps free-response as single lines too)
      if (cur?.options?.length) flush();
      continue;
    }
    const key = correctLine(t);
    if (key != null && cur) {
      cur.correctLetter = key;
      continue;
    }
    const opt = optionLine(t);
    if (opt && cur) {
      cur.options = cur.options || [];
      // Fill gaps if letters skip (rare)
      cur.options.push(opt.text);
      continue;
    }
    // One-line MC: "Question? a) x b) y c) z d) w"
    const inline = t.match(/^(.*?\?)\s+((?:\(?[A-Da-d]\)?[\)\.\:\-]\s*.+))$/i);
    if (inline) {
      flush();
      const prompt = inline[1].trim();
      const opts = parseOptionsBlob(inline[2]);
      if (opts.length >= 2) {
        questions.push({ prompt, options: opts });
        cur = null;
        continue;
      }
    }
    // New question prompt
    flush();
    cur = { prompt: t, options: [] };
  }
  flush();
  return questions;
}

/** Serialize questions back to admin textarea format. */
export function serializeQuestions(questions) {
  if (!Array.isArray(questions)) return '';
  return questions
    .map((q) => {
      const prompt = typeof q === 'string' ? q : q?.prompt || '';
      if (!prompt) return '';
      const opts = typeof q === 'object' && Array.isArray(q.options) ? q.options : null;
      if (!opts?.length) return prompt;
      const lines = [prompt];
      opts.forEach((o, i) => lines.push(`${indexToLetter(i)}. ${o}`));
      if (q.correctIndex != null && q.correctIndex !== '') {
        lines.push(`Correct: ${indexToLetter(Number(q.correctIndex))}`);
      }
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Human-readable answer for grading / My Tests review. */
export function formatQuestionAnswer(qq, raw) {
  if (raw == null || raw === '') return 'â€”';
  const opts = Array.isArray(qq?.options) ? qq.options : [];
  if (opts.length) {
    let idx = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(idx)) idx = letterToIndex(raw, opts.length);
    if (idx != null && opts[idx] != null) {
      return `${indexToLetter(idx)}. ${opts[idx]}`;
    }
  }
  return String(raw);
}

