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
    // For images we pass base64 to the model (vision)
    return ''
  }

  // Fallback (txt etc)
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

  // Ensure minimum content so UI never "dies"
  if (!out.title) out.title = 'Untitled plan'
  if (!out.quick_summary) out.quick_summary = 'No summary generated.'
  if (!out.study_notes) out.study_notes = 'No notes generated.'

  return out
}

function buildSystemPrompt() {
  return `
You are Examly. Output ONLY valid JSON, no markdown fences.
Return this shape:
{
  "title": string,
  "language": string,
  "exam_date": string|null,
  "confidence": number,
  "quick_summary": string,
  "study_notes": string,
  "flashcards": [{"front": string, "back": string}],
  "daily_plan": [{"day": string, "focus": string, "minutes": number, "tasks": string[], "blocks": [{"type":"study"|"break","minutes":number,"label":string}]}],
  "practice_questions": [{"id": string, "type":"mcq"|"short", "question": string, "options": string[]|null, "answer": string|null, "explanation": string|null}],
  "notes": string[]
}
Keep it concise but useful.
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

  // Build a message for vision if images exist
  const userContent: any[] = []
  userContent.push({ type: 'text', text: `USER PROMPT:\n${prompt || '(empty)'}\n\nFILES TEXT:\n${textFromFiles || '(none)'}` })

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
    await consumeGeneration(user.id, 'plan')

    const form = await req.formData()
    const prompt = String(form.get('prompt') ?? '')

    // ACCEPT BOTH 'files' and 'file' (your frontend used 'file' earlier)
    const files = [
      ...(form.getAll('files') as File[]),
      ...(form.getAll('file') as File[]),
    ].filter(Boolean) as File[]

    const fileNames = files.map((f) => f.name).slice(0, 20)

    const openAiKey = process.env.OPENAI_API_KEY
    if (!openAiKey) {
      // IMPORTANT: wrap in {result: ...} so frontend always works
      return NextResponse.json({ result: mock(prompt, fileNames) })
    }

    const client = new OpenAI({ apiKey: openAiKey })

    // Extract text from PDFs / txt
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

    // Use a sane default model
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const raw = await callModel(client, model, prompt, textFromFiles, imageParts)
    const parsed = safeParseJson(raw)
    const plan = normalizePlan(parsed)

    // IMPORTANT: wrap in {result: ...}
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
        ? `## Jegyzetek (mock)\n- Add meg a Vercelben az OPENAI_API_KEY-t\n- Utána a Generálás valós tartalmat ad\n\n## Következő lépés\n- Próbáld újra a Generatet`
        : `## Notes (mock)\n- Add OPENAI_API_KEY in Vercel\n- Then Generate returns real content\n\n## Next\n- Try Generate again`,
    flashcards: [
      { front: 'Key term', back: 'Short definition' },
      { front: 'Example', back: 'One worked example' },
    ],
    daily_plan: [
      {
        day: 'Day 1',
        focus: 'Read + highlight key terms',
        minutes: 60,
        tasks: ['Skim notes', 'Mark unclear parts', 'Make 10 flashcards'],
        blocks: [
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 5, label: 'Break' },
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 10, label: 'Break' },
        ],
      },
      {
        day: 'Day 2',
        focus: 'Active recall + summary',
        minutes: 60,
        tasks: ['Rewrite summary', 'Answer 8 short questions', 'Fix weak spots'],
        blocks: [
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 5, label: 'Break' },
          { type: 'study', minutes: 25, label: 'Focus' },
          { type: 'break', minutes: 10, label: 'Break' },
        ],
      },
    ],
    practice_questions: Array.from({ length: 15 }).map((_, i) => ({
      id: `q${i + 1}`,
      type: i % 2 === 0 ? 'mcq' : 'short',
      question: i % 2 === 0 ? 'Which option best matches the topic?' : 'Write a 2–3 sentence summary.',
      options: i % 2 === 0 ? ['A', 'B', 'C', 'D'] : null,
      answer: i % 2 === 0 ? 'A' : null,
      explanation: '',
    })),
    notes: ['Add OPENAI_API_KEY to enable real generation.'],
  })
}
