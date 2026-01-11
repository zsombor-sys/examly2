import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { consumeGeneration } from '@/lib/creditsServer'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'

export const runtime = 'nodejs'

function toBase64(buf: ArrayBuffer) {
  return Buffer.from(buf).toString('base64')
}

function isImage(name: string, type: string) {
  return type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name)
}

function isPdf(name: string, type: string) {
  return type === 'application/pdf' || /\.pdf$/i.test(name)
}

async function fileToText(file: File) {
  const arr = await file.arrayBuffer()
  const name = file.name || 'file'
  const type = file.type || ''

  if (isPdf(name, type)) {
    const parsed = await pdfParse(Buffer.from(arr))
    return parsed.text?.slice(0, 120_000) ?? ''
  }

  if (isImage(name, type)) {
    return ''
  }

  return Buffer.from(arr).toString('utf8').slice(0, 120_000)
}

const OUTPUT_TEMPLATE = {
  title: '',
  language: 'English',
  exam_date: null as string | null,
  confidence: 6,
  quick_summary: '',
  study_notes: '',
  flashcards: [] as Array<{ front: string; back: string }>,
  daily_plan: [] as Array<{
    day: string
    focus: string
    minutes: number
    tasks: string[]
    blocks?: Array<{ type: 'study' | 'break'; minutes: number; label: string }>
  }>,
  practice_questions: [] as Array<{
    id: string
    type: 'mcq' | 'short'
    question: string
    options?: string[] | null
    answer?: string | null
    explanation?: string | null
  }>,
  notes: [] as string[],
}

/**
 * ✅ FIX: Model sometimes returns LaTeX with single backslashes inside JSON strings (e.g. \frac, \(, \sqrt),
 * which breaks JSON.parse with "Bad escaped character".
 *
 * This parser:
 * 1) tries normal JSON.parse
 * 2) extracts first {...} block and tries parse
 * 3) repairs invalid backslashes (turns \x into \\x unless it's a valid JSON escape)
 */
function safeParseJson(text: string) {
  const extractJson = (s: string) => {
    const m = s.match(/\{[\s\S]*\}/)
    return m ? m[0] : s
  }

  const repairBackslashesForJson = (s: string) => {
    // Replace invalid JSON escapes like \a \s \( \frac etc. with \\a \\s \\( \\frac
    // Keep valid escapes: \" \\ \/ \b \f \n \r \t \uXXXX
    return s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
  }

  try {
    return JSON.parse(text)
  } catch {}

  const extracted = extractJson(text)
  try {
    return JSON.parse(extracted)
  } catch {}

  const repaired = repairBackslashesForJson(extracted)
  try {
    return JSON.parse(repaired)
  } catch (e: any) {
    const snippet = repaired.slice(0, 400)
    throw new Error(`Model did not return valid JSON (after repair). Snippet:\n${snippet}`)
  }
}

function normalizePlan(obj: any) {
  const out: any = { ...OUTPUT_TEMPLATE, ...(obj ?? {}) }

  out.title = String(out.title ?? '').trim()
  out.language = String(out.language ?? 'English').trim() || 'English'
  out.exam_date = out.exam_date ? String(out.exam_date) : null
  out.confidence = Number.isFinite(Number(out.confidence)) ? Number(out.confidence) : 6

  out.quick_summary = String(out.quick_summary ?? '')
  out.study_notes = String(out.study_notes ?? '')

  out.flashcards = Array.isArray(out.flashcards) ? out.flashcards : []
  out.flashcards = out.flashcards
    .map((c: any) => ({
      front: String(c?.front ?? '').trim(),
      back: String(c?.back ?? '').trim(),
    }))
    .filter((c: any) => c.front.length > 0 || c.back.length > 0)
    .slice(0, 60)

  out.daily_plan = Array.isArray(out.daily_plan) ? out.daily_plan : []
  out.daily_plan = out.daily_plan.slice(0, 30).map((d: any, i: number) => ({
    day: String(d?.day ?? `Day ${i + 1}`),
    focus: String(d?.focus ?? ''),
    minutes: Number.isFinite(Number(d?.minutes)) ? Number(d.minutes) : 60,
    tasks: Array.isArray(d?.tasks) ? d.tasks.map((t: any) => String(t)) : [],
    blocks: Array.isArray(d?.blocks)
      ? d.blocks
          .map((b: any) => ({
            type: b?.type === 'break' ? 'break' : 'study',
            minutes: Number.isFinite(Number(b?.minutes)) ? Number(b.minutes) : 25,
            label: String(b?.label ?? '').trim() || (b?.type === 'break' ? 'Break' : 'Focus'),
          }))
          .slice(0, 12)
      : undefined,
  }))

  out.practice_questions = Array.isArray(out.practice_questions) ? out.practice_questions : []
  out.practice_questions = out.practice_questions.slice(0, 40).map((q: any, i: number) => ({
    id: String(q?.id ?? `q${i + 1}`),
    type: q?.type === 'short' ? 'short' : 'mcq',
    question: String(q?.question ?? ''),
    options: Array.isArray(q?.options) ? q.options.map((o: any) => String(o)) : null,
    answer: q?.answer != null ? String(q.answer) : null,
    explanation: q?.explanation != null ? String(q.explanation) : null,
  }))

  out.notes = Array.isArray(out.notes) ? out.notes.map((x: any) => String(x)) : []

  if (!out.title) out.title = 'Untitled plan'
  if (!out.quick_summary) out.quick_summary = 'No summary generated.'
  if (!out.study_notes) out.study_notes = 'No notes generated.'

  return out
}

function buildSystemPrompt() {
  return `
You are Examly. Output ONLY valid JSON (no extra text, no markdown fences).

CRITICAL JSON RULE:
- In JSON strings you MUST escape backslashes. Example: to output \\(x^2\\) you must write \\\\(...\\\\) in JSON source.

Return this exact shape:
{
  "title": string,
  "language": "Hungarian"|"English",
  "exam_date": string|null,
  "confidence": number,
  "quick_summary": string,
  "study_notes": string,
  "flashcards": [{"front": string, "back": string}],
  "daily_plan": [{"day": string, "focus": string, "minutes": number, "tasks": string[], "blocks": [{"type":"study"|"break","minutes":number,"label":string}]}],
  "practice_questions": [{"id": string, "type":"mcq"|"short", "question": string, "options": string[]|null, "answer": string|null, "explanation": string|null}],
  "notes": string[]
}

LANGUAGE:
- If the user's prompt is Hungarian (or mentions Hungarian school terms), output Hungarian text and set language="Hungarian".
- Otherwise output English text and set language="English".

STYLE GOAL (VERY IMPORTANT):
- Write like a school notebook / textbook, NOT like a chat dump.
- Use clean headings, short bullets, and step-by-step explanations.

MATH FORMATTING (KaTeX):
- In study_notes and explanations, use ONLY KaTeX-friendly LaTeX delimiters:
  inline: \\( ... \\)
  block:  \\[ ... \\]
- Prefer school notation: \\frac, \\sqrt, parentheses, \\cdot.
- Do not use $$.

STUDY_NOTES STRUCTURE (must follow):
Use Markdown with these sections (omit irrelevant ones):
1) # FOGALMAK / DEFINITIONS
2) # KÉPLETEK / FORMULAS (with clean block formulas)
3) # LÉPÉSEK / METHOD (numbered steps)
4) # PÉLDA (at least 1 worked example if topic is math/physics/chemistry)
   - show steps
   - final answer clearly
5) # GYAKORI HIBÁK / COMMON MISTAKES
6) # GYORS ELLENŐRZŐLISTA / CHECKLIST

DAILY_PLAN:
- Keep focus short (max ~8 words), no long paragraphs.
- tasks should be short bullets (max ~12 words each).
- blocks: use typical pomodoro: 25/5/25/10 (or similar), max 8 blocks per day.

PRACTICE_QUESTIONS:
- For math: include steps in explanation using \\( \\) and \\[ \\].
- Keep question text concise.
`.trim()
}

async function callModel(
  client: OpenAI,
  model: string,
  prompt: string,
  textFromFiles: string,
  images: Array<{ name: string; b64: string; mime: string }>
) {
  const sys = buildSystemPrompt()

  const userContent: any[] = []
  userContent.push({
    type: 'text',
    text: `USER PROMPT:\n${prompt || '(empty)'}\n\nFILES TEXT:\n${textFromFiles || '(none)'}`,
  })

  for (const img of images.slice(0, 6)) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.b64}` },
    })
  }

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: userContent as any },
    ],
    temperature: 0.3,
  })

  return resp.choices?.[0]?.message?.content ?? ''
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    await consumeGeneration(user.id)

    const form = await req.formData()
    const prompt = String(form.get('prompt') ?? '')

    const files = [...(form.getAll('files') as File[]), ...(form.getAll('file') as File[])]
      .filter(Boolean) as File[]

    const fileNames = files.map((f) => f.name).slice(0, 20)

    const openAiKey = process.env.OPENAI_API_KEY
    if (!openAiKey) {
      return NextResponse.json({ result: mock(prompt, fileNames) })
    }

    const client = new OpenAI({ apiKey: openAiKey })

    const textParts: string[] = []
    const imageParts: Array<{ name: string; b64: string; mime: string }> = []

    for (const f of files.slice(0, 6)) {
      const name = f.name || 'file'
      const type = f.type || ''
      if (isImage(name, type)) {
        const arr = await f.arrayBuffer()
        imageParts.push({ name, mime: type || 'image/png', b64: toBase64(arr) })
      } else {
        const t = await fileToText(f)
        if (t) textParts.push(`--- ${name} ---\n${t}`)
      }
    }

    const textFromFiles = textParts.join('\n\n').slice(0, 120_000)

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const raw = await callModel(client, model, prompt, textFromFiles, imageParts)
    const parsed = safeParseJson(raw)
    const plan = normalizePlan(parsed)

    return NextResponse.json({ result: plan })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: e?.status ?? 400 })
  }
}

function mock(prompt: string, fileNames: string[]) {
  const lang = /\bhu\b|magyar|szia|tétel|vizsga|érettségi/i.test(prompt) ? 'Hungarian' : 'English'

  return normalizePlan({
    title: 'Mock plan (no OpenAI key yet)',
    language: lang,
    exam_date: null,
    confidence: 6,
    quick_summary: `Mock response so you can test the UI.\n\nPrompt: ${prompt || '(empty)'}\nUploads: ${fileNames.join(', ') || '(none)'}`,
    study_notes:
      lang === 'Hungarian'
        ? `# FOGALMAK (mock)\n- Példa: másodfokú egyenlet alakja: \\(ax^2+bx+c=0\\)\n\n# KÉPLETEK (mock)\n\\[D=b^2-4ac\\]\n\\[x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}\\]\n\n# LÉPÉSEK\n1. Azonosítsd: \\(a,b,c\\)\n2. Számold ki: \\(D\\)\n3. Számold ki a gyököket\n\n# PÉLDA\nOldd meg: \\(x^2-5x+6=0\\)\n\\[D=(-5)^2-4\\cdot1\\cdot6=25-24=1\\]\n\\[x_{1,2}=\\frac{5\\pm1}{2}\\Rightarrow x_1=3,\\ x_2=2\\]\n\n# GYAKORI HIBÁK\n- Elfelejted a \\(2a\\)-t a nevezőben.\n`
        : `# DEFINITIONS (mock)\n- Quadratic: \\(ax^2+bx+c=0\\)\n\n# FORMULAS\n\\[D=b^2-4ac\\]\n\\[x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}\\]\n`,
    flashcards: [
      { front: 'Key term', back: 'Short definition' },
      { front: 'Example', back: 'One worked example' },
    ],
    daily_plan: [
      {
        day: 'Day 1',
        focus: 'Definitions + formulas',
        minutes: 60,
        tasks: ['Memorize D formula', 'Solve 6 easy equations', 'Check answers'],
        blocks: [
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 5, label: 'Break' },
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 10, label: 'Break' },
        ],
      },
    ],
    practice_questions: [
      {
        id: 'q1',
        type: 'short',
        question: 'Solve: \\(x^2-5x+6=0\\).',
        options: null,
        answer: 'x=2 and x=3',
        explanation: '\\[D=(-5)^2-4\\cdot1\\cdot6=1\\]\\[x_{1,2}=\\frac{5\\pm1}{2}\\Rightarrow x_1=3, x_2=2\\]',
      },
    ],
    notes: ['Add OPENAI_API_KEY to enable real generation.'],
  })
}
