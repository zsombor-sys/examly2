import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { consumeGeneration } from '@/lib/creditsServer'
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import { getPlan, savePlan } from '@/app/api/plan/store'

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

  if (isImage(name, type)) return ''
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

function safeParseJson(text: string) {
  const raw = String(text ?? '')
  if (!raw.trim()) throw new Error('Model returned empty response (no JSON).')

  const extractJson = (s: string) => {
    const m = s.match(/\{[\s\S]*\}/)
    return m ? m[0] : s
  }

  const repairBackslashesForJson = (s: string) => {
    // Keep valid escapes: \" \\ \/ \b \f \n \r \t \uXXXX
    // Repair everything else: \( \) \frac \sqrt -> \\( \\) \\frac \\sqrt
    return s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
  }

  try {
    return JSON.parse(raw)
  } catch {}

  const extracted = extractJson(raw)
  try {
    return JSON.parse(extracted)
  } catch {}

  const repaired = repairBackslashesForJson(extracted)
  try {
    return JSON.parse(repaired)
  } catch {
    const snippet = repaired.slice(0, 700)
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
You are Examly.

Return ONLY a JSON object that matches this shape:
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
- If the user prompt is Hungarian, output Hungarian and set language="Hungarian". Otherwise English.

STYLE:
- Write like a school notebook/textbook.
- Clean headings, short bullets, step-by-step.
- No chatty filler.

MATH (KaTeX):
- Inline \\( ... \\)
- Block \\[ ... \\]
- Prefer \\frac, \\sqrt, \\cdot
- No $$

STUDY_NOTES headings:
# FOGALMAK / DEFINITIONS
# KÉPLETEK / FORMULAS
# LÉPÉSEK / METHOD
# PÉLDA
# GYAKORI HIBÁK / COMMON MISTAKES
# GYORS ELLENŐRZŐLISTA / CHECKLIST

DAILY_PLAN:
- focus <= ~8 words
- tasks <= ~12 words each
- blocks typical pomodoro: 25/5/25/10, max 8/day
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

  const userContent: any[] = [
    { type: 'text', text: `USER PROMPT:\n${prompt || '(empty)'}\n\nFILES TEXT:\n${textFromFiles || '(none)'}` },
  ]

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
    response_format: { type: 'json_object' }, // ✅ forces strict JSON object output
  })

  return resp.choices?.[0]?.message?.content ?? ''
}

/** ✅ GET /api/plan?id=... : load saved plan */
export async function GET(req: Request) {
  const user = await requireUser(req)
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const row = getPlan(user.id, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ result: row.result })
}

/** ✅ POST /api/plan : generate + SAVE */
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
      const plan = mock(prompt, fileNames)
      const saved = savePlan(user.id, plan.title, plan)
      return NextResponse.json({ id: saved.id, result: plan })
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

    const saved = savePlan(user.id, plan.title, plan)
    return NextResponse.json({ id: saved.id, result: plan })
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
        ? `# FOGALMAK / DEFINITIONS
- Másodfokú egyenlet: \\(ax^2+bx+c=0\\), \\(a\\neq 0\\)

# KÉPLETEK / FORMULAS
\\[D=b^2-4ac\\]
\\[x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}\\]

# LÉPÉSEK / METHOD
1. Azonosítsd: \\(a,b,c\\)
2. Számold ki: \\(D\\)
3. Állapítsd meg a gyökök számát \\(D\\) alapján
4. Számold ki \\(x_1\\), \\(x_2\\)

# PÉLDA
Oldd meg: \\(x^2-5x+6=0\\)
\\[D=(-5)^2-4\\cdot1\\cdot6=25-24=1\\]
\\[x_{1,2}=\\frac{5\\pm1}{2}\\Rightarrow x_1=3,\\ x_2=2\\]

# GYAKORI HIBÁK / COMMON MISTAKES
- Elfelejted a \\(2a\\)-t a nevezőben.

# GYORS ELLENŐRZŐLISTA / CHECKLIST
- Megvan \\(a,b,c\\)?
- Megvan \\(D\\)?
- Helyes a nevező: \\(2a\\)?
`
        : `# DEFINITIONS
- Quadratic: \\(ax^2+bx+c=0\\), \\(a\\neq0\\)

# FORMULAS
\\[D=b^2-4ac\\]
\\[x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}\\]
`,
    flashcards: [
      { front: 'Diszkrimináns', back: 'D = b^2 - 4ac' },
      { front: 'Gyökképlet', back: 'x = (-b ± √D) / (2a)' },
    ],
    daily_plan: [
      {
        day: '1. nap',
        focus: 'Képletek + alapfeladatok',
        minutes: 60,
        tasks: ['Képletek bemagolása', '6 könnyű feladat', 'Ellenőrzés'],
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
        question: 'Oldd meg: \\(x^2-5x+6=0\\).',
        options: null,
        answer: 'x=2 és x=3',
        explanation:
          '\\[D=(-5)^2-4\\cdot1\\cdot6=1\\]\\[x_{1,2}=\\frac{5\\pm1}{2}\\Rightarrow x_1=3,\\ x_2=2\\]',
      },
    ],
    notes: ['Add OPENAI_API_KEY to enable real generation.'],
  })
}
