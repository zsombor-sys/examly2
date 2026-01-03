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
  return type === 'application/pdf' || /\.(pdf)$/i.test(name)
}

// Minimal, resilient plan generator.
// We do NOT use strict JSON schema enforcement in the API call because SDK/API variants can reject schemas.
// Instead: we instruct the model to output JSON, then we parse + lightly normalize server-side.
const OUTPUT_TEMPLATE = {
  title: '',
  language: '',
  exam_date: null as string | null,
  confidence: null as number | null,
  // Detailed day plan. Each day has focus + tasks + minutes, and optional blocks for pomodoro-like flow.
  daily_plan: [
    {
      day: '',
      focus: '',
      minutes: 0,
      tasks: [''],
      blocks: [{ type: 'study' as 'study' | 'break', minutes: 25, label: 'Focus' }],
    },
  ],
  quick_summary: '',
  // Learnable notes (markdown-ish plain text)
  study_notes: '',
  flashcards: [{ front: '', back: '' }],
  practice_questions: [
    { type: 'mcq' as 'mcq' | 'short', question: '', options: [''], answer: null as string | null, explanation: '' },
  ],
  notes: [''],
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error('Model did not return JSON')
  }
}

function normalizePlan(obj: any) {
  const out: any = { ...OUTPUT_TEMPLATE, ...(obj ?? {}) }

  // Arrays
  out.daily_plan = Array.isArray(out.daily_plan) ? out.daily_plan : []
  out.practice_questions = Array.isArray(out.practice_questions) ? out.practice_questions : []
  out.flashcards = Array.isArray(out.flashcards) ? out.flashcards : []
  out.notes = Array.isArray(out.notes) ? out.notes : []

  out.daily_plan = out.daily_plan.map((d: any) => {
    const tasks = Array.isArray(d?.tasks) ? d.tasks.map(String) : []
    const blocksRaw = Array.isArray(d?.blocks) ? d.blocks : []
    const blocks = blocksRaw.map((b: any) => ({
      type: b?.type === 'break' ? 'break' : 'study',
      minutes: Number(b?.minutes ?? 25),
      label: String(b?.label ?? (b?.type === 'break' ? 'Break' : 'Focus')),
    }))
    return {
      day: String(d?.day ?? ''),
      focus: String(d?.focus ?? ''),
      minutes: Number(d?.minutes ?? (tasks.length ? tasks.length * 25 : 60)),
      tasks,
      blocks: blocks.length ? blocks : [{ type: 'study', minutes: 25, label: 'Focus' }, { type: 'break', minutes: 5, label: 'Break' }],
    }
  })

  out.practice_questions = out.practice_questions.map((q: any, idx: number) => ({
    type: q?.type === 'short' ? 'short' : 'mcq',
    question: String(q?.question ?? ''),
    options: q?.options === null ? null : Array.isArray(q?.options) ? q.options.map(String) : null,
    answer: q?.answer === null || q?.answer === undefined ? null : String(q?.answer),
    explanation: String(q?.explanation ?? ''),
    id: String(q?.id ?? `q${idx + 1}`),
  }))

  out.flashcards = out.flashcards
    .map((c: any) => ({ front: String(c?.front ?? ''), back: String(c?.back ?? '') }))
    .filter((c: any) => c.front || c.back)

  out.title = String(out.title ?? 'Study plan')
  out.language = String(out.language ?? 'Hungarian')
  out.quick_summary = String(out.quick_summary ?? '')
  out.study_notes = String(out.study_notes ?? '')
  out.exam_date = out.exam_date === null || out.exam_date === undefined ? null : String(out.exam_date)
  out.confidence = out.confidence === null || out.confidence === undefined ? null : Number(out.confidence)

  // Ensure minimum practice questions: 15
  if (out.practice_questions.length < 15) {
    const need = 15 - out.practice_questions.length
    for (let i = 0; i < need; i++) {
      out.practice_questions.push({
        id: `q${out.practice_questions.length + 1}`,
        type: 'short',
        question: 'Write a short explanation of the key concept in your own words.',
        options: null,
        answer: null,
        explanation: '',
      })
    }
  }

  return out
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    await consumeGeneration(user.id)

    const form = await req.formData()
    const prompt = String(form.get('prompt') ?? '')
    const files = form.getAll('files') as File[]

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json(mock(prompt, files.map((f) => f.name)))
    }

    const openai = new OpenAI({ apiKey })

    const extractedTexts: string[] = []
    const imageDataUrls: string[] = []

    for (const f of files) {
      const ab = await f.arrayBuffer()
      if (isPdf(f.name, f.type)) {
        const parsed = await pdfParse(Buffer.from(ab))
        if (parsed.text?.trim()) extractedTexts.push(parsed.text.slice(0, 12000))
      } else if (isImage(f.name, f.type)) {
        const b64 = toBase64(ab)
        const mime = f.type || 'image/png'
        imageDataUrls.push(`data:${mime};base64,${b64}`)
      }
    }

    const userContent: any[] = []
    if (prompt.trim()) userContent.push({ type: 'input_text', text: `User request:\n${prompt}` })
    if (extractedTexts.length) {
      userContent.push({
        type: 'input_text',
        text: `Extracted text from PDFs/notes (may be partial):\n${extractedTexts.join('\n\n---\n\n').slice(0, 20000)}`,
      })
    }
    for (const url of imageDataUrls.slice(0, 6)) userContent.push({ type: 'input_image', image_url: url })

    const system = `You are Examly, an exam-prep assistant.

Return ONLY valid JSON. No commentary outside JSON.

Math formatting (if the topic involves math/physics/chemistry):
- You MUST format every mathematical expression using KaTeX-compatible LaTeX.
- Use \(...\) for inline math and \[...\] for display formulas.
- Use \frac{a}{b} for fractions, \sqrt{...} for roots, exponents like x^2.
- Use school-style operators: \cdot for multiplication, : or \div for division.
- Keep algebra correct: verify each step, avoid made-up examples, and use standard notation taught in school.
- IMPORTANT: You are returning JSON. In JSON strings you MUST escape backslashes.
  Example: write \\frac{a}{b} (NOT \frac{a}{b}) so the JSON stays valid and the UI renders correct LaTeX.
- Never output LaTeX commands without the leading backslash (e.g. never write "frac"; always write "\\frac").
- Do NOT wrap formulas in plain brackets like [ ... ]. Always use \\(...\\) or \\[...]\\].
- End worked examples with a clear final line: "Válasz:" (HU) or "Final answer:" (EN).

You MUST output these top-level keys:
- title (string)
- language (string: Hungarian or English)
- exam_date (string or null)
- confidence (number 0-10 or null)
- quick_summary (string)
- study_notes (string)  // structured notes with clear sections/headings and bullet points
- flashcards (array of {front, back})
- daily_plan (array). Each item: {day, focus, minutes, tasks, blocks}
  - blocks is an array of {type: "study"|"break", minutes, label}
  - Make blocks realistic: study blocks 20-35 min, breaks 5-10 min, 4 cycles then a longer break.
- practice_questions (array, 15-20 items). Each: {id, type:"mcq"|"short", question, options|null, answer|null, explanation}
- notes (array of strings) // any missing info, assumptions

Rules:
- Use the uploaded material (PDF text + images). If something isn't in it, say so in notes.
- If user writes Hungarian, respond in Hungarian.
 - If images look handwritten, do your best to read them and extract topics.
 - Make the daily plan tailored to the exam date.

Formatting for study_notes:
- Write in clean Markdown.
- Use short sections with headings (e.g. "## 1) ..."), blank lines between sections.
- Prefer bullet points, then one short worked example per key topic.
- Keep it "átlag diák" friendly: simple wording, clear steps, no unnecessary theory.
`


    const preferredModel = process.env.OPENAI_MODEL ?? 'gpt-4.1'

    async function callModel(model: string) {
      return await openai.responses.create({
        model,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: userContent },
        ],
      })
    }

    let resp
    try {
      resp = await callModel(preferredModel)
    } catch (err: any) {
      // Fallback if the model isn't available on this account
      resp = await callModel('gpt-4o-mini')
    }

    const raw = resp.output_text
    const parsed = safeParseJson(raw)
    const plan = normalizePlan(parsed)
    return NextResponse.json(plan)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: (e?.status ?? 400) })
  }
}

function mock(prompt: string, fileNames: string[]) {
  return {
    title: 'Mock plan (no OpenAI key yet)',
    language: /\bhu\b|magyar/i.test(prompt) ? 'Hungarian' : 'English',
    exam_date: null,
    confidence: 6,
    daily_plan: [
      { day: 'Day 1', focus: 'Read + highlight key terms', minutes: 60, tasks: ['Skim notes', 'Mark unclear parts', 'Make 10 flashcards'] },
      { day: 'Day 2', focus: 'Active recall + summary', minutes: 60, tasks: ['Rewrite summary', 'Answer 8 short questions', 'Fix weak spots'] },
      { day: 'Day 3', focus: 'Practice test + review', minutes: 60, tasks: ['Take mini test', 'Check answers', 'Review mistakes'] },
    ],
    quick_summary: `This is a safe mock response so you can test the UI.\n\nPrompt: ${prompt || '(empty)'}\nUploads: ${fileNames.join(', ') || '(none)'}`,
    practice_questions: [
      { type: 'mcq', question: 'Which option best describes the main topic?', options: ['A', 'B', 'C', 'D'], answer: 'A' },
      { type: 'short', question: 'Write a 2–3 sentence summary of the material.', options: null, answer: 'Key points + example' },
    ],
    notes: ['Add OPENAI_API_KEY to enable real generation.'],
  }
}
