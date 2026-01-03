import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { consumeGeneration } from '@/lib/creditsServer'
import OpenAI from 'openai'

export const runtime = 'nodejs'

function safeParseJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error('Model did not return JSON')
  }
}

function normalize(payload: any) {
  const out: any = { ...(payload ?? {}) }
  out.title = String(out.title ?? 'Vocab set')
  out.language = String(out.language ?? 'English ⇄ Hungarian')
  out.items = Array.isArray(out.items) ? out.items : []
  out.items = out.items
    .map((x: any) => ({
      term: String(x?.term ?? '').trim(),
      translation: String(x?.translation ?? '').trim(),
      example: x?.example ? String(x.example) : undefined,
    }))
    .filter((x: any) => x.term && x.translation)
    .slice(0, 300)
  return out
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    await consumeGeneration(user.id)

    const user = await requireUser(req)
    await consumeGeneration(user.id)

    const form = await req.formData()
    const words = String(form.get('words') ?? '').trim()
    const files = form.getAll('files') as File[]
    const sourceLang = String(form.get('sourceLang') ?? 'en')
    const targetLang = String(form.get('targetLang') ?? 'hu')

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      // mock
      const lines = words.split(/\n/).filter(Boolean).slice(0, 10)
      return NextResponse.json({
        title: 'Vocab set (mock)',
        language: `${sourceLang} → ${targetLang}`,
        items: lines.map((l, i) => ({ term: l.split('-')[0]?.trim() || `word${i+1}`, translation: 'fordítás', example: 'Example sentence.' })),
      })
    }

    const openai = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

    const langName: Record<string, string> = {
      en: 'English',
      hu: 'Hungarian',
      de: 'German',
      es: 'Spanish',
      it: 'Italian',
      la: 'Latin',
    }

    const system = `You are Examly Vocab.
Create a clean vocabulary set for studying.

Return ONLY valid JSON with this exact shape:
{
  "title": string,
  "language": string,   // e.g. "English → Hungarian"
  "items": [{"term": string, "translation": string, "example"?: string}]
}

Rules:
- The user selects a direction using sourceLang and targetLang.
- Translate FROM sourceLang TO targetLang.
- Supported languages: English, Hungarian, German, Spanish, Italian, Latin.
- If the user provides "term - translation" pairs, preserve them when they match the chosen direction.
- If images are provided, FIRST extract the words/pairs you see in the images (keep the order, fix obvious typos), then build the set.
- Do not invent words that are not present unless the image is unreadable (in that case, add a note to examples like "(unclear in photo)").
- Keep it student-friendly. Use everyday vocabulary if input is unclear.
- Provide a short example sentence for ~30-60% of items (optional).`

    const content: any[] = [{ type: 'input_text', text: system }]

    const userParts: any[] = []
    const src = langName[sourceLang] ?? sourceLang
    const tgt = langName[targetLang] ?? targetLang

    if (words) {
      userParts.push({
        type: 'input_text',
        text:
          `Direction: ${src} → ${tgt}\n\n` +
          `Input words/pairs (may contain separators like "-" or ":"):\n${words}\n\n` +
          `Create flashcards translated ${src} → ${tgt}. If a line already includes a correct translation in this direction, keep it.`,
      })
    } else {
      userParts.push({
        type: 'input_text',
        text:
          `Direction: ${src} → ${tgt}\n\n` +
          `No typed words provided. Extract a vocabulary list from the image(s) and create flashcards translated ${src} → ${tgt}.`,
      })
    }

    for (const f of files.slice(0, 6)) {
      const ab = await f.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      const mime = f.type || 'image/png'
      userParts.push({ type: 'input_image', image_url: `data:${mime};base64,${b64}` })
    }

    const resp = await openai.responses.create({
      model,
      input: [
        { role: 'system', content },
        { role: 'user', content: userParts },
      ],
    })

    const txt = resp.output_text
    const parsed = safeParseJson(txt)
    const normalized = normalize(parsed)

    // Free hard-cap safeguard: if user sent >70 lines we still keep reasonable size
    normalized.items = normalized.items.slice(0, 300)

    return NextResponse.json(normalized)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: (e?.status ?? 400) })
  }
}
