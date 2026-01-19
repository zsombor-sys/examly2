import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { consumeGeneration, entitlementSnapshot, getOrCreateProfile } from '@/lib/creditsServer'
import OpenAI from 'openai'

export const runtime = 'nodejs'

function safeParseJson(text: string) {
  const raw = String(text ?? '').trim()
  if (!raw) throw new Error('Model returned empty response (no JSON).')

  try {
    return JSON.parse(raw)
  } catch {}

  const m = raw.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {}
  }

  const repaired = raw.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
  const m2 = repaired.match(/\{[\s\S]*\}/)
  if (m2) return JSON.parse(m2[0])

  throw new Error('Model did not return valid JSON.')
}

function normalize(payload: any) {
  const out: any = { ...(payload ?? {}) }
  out.title = String(out.title ?? 'Vocab set')
  out.language = String(out.language ?? 'English → Hungarian')
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

function langLabel(code: string) {
  const map: Record<string, string> = {
    en: 'English',
    hu: 'Hungarian',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    la: 'Latin',
  }
  return map[code] ?? code
}

function pickErrorInfo(e: any) {
  const status = Number(e?.status) || Number(e?.response?.status) || 500
  const code = e?.code || e?.error?.code || null
  const message = e?.message || e?.error?.message || 'Server error'
  const type = e?.type || e?.error?.type || null
  return { status, code, type, message }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)

    // ✅ PRECHECK: ne generáljunk ha tényleg nincs entitlement
    const profile = await getOrCreateProfile(user.id)
    const ent = entitlementSnapshot(profile as any)
    if (!ent.ok) {
      return NextResponse.json(
        { error: 'No credits left', code: 'NO_CREDITS', status: 402, where: 'api/vocab:precheck' },
        { status: 402, headers: { 'cache-control': 'no-store' } }
      )
    }

    const form = await req.formData()
    const words = String(form.get('words') ?? '').trim()
    const files = (form.getAll('files') as File[]).filter(Boolean)
    const sourceLang = String(form.get('sourceLang') ?? 'en')
    const targetLang = String(form.get('targetLang') ?? 'hu')

    const apiKey = process.env.OPENAI_API_KEY

    // mock is “success” -> consume at the end too
    if (!apiKey) {
      const lines = words.split(/\n/).filter(Boolean).slice(0, 20)
      const result = {
        title: 'Vocab set (mock)',
        language: `${sourceLang} → ${targetLang}`,
        items: lines.map((l, i) => ({
          term: l.split('-')[0]?.trim() || `word${i + 1}`,
          translation: 'fordítás',
          example: 'Example sentence.',
        })),
      }

      // ✅ ONLY NOW consume
      await consumeGeneration(user.id)

      return NextResponse.json(result, { headers: { 'cache-control': 'no-store', 'x-examly-vocab': 'mock' } })
    }

    const openai = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const src = langLabel(sourceLang)
    const tgt = langLabel(targetLang)

    const system = `
You are Examly Vocab.

Return ONLY a JSON object with this exact shape:
{
  "title": string,
  "language": string,
  "items": [{"term": string, "translation": string, "example"?: string}]
}

Rules:
- Translate FROM sourceLang TO targetLang.
- If the user provides "term - translation" pairs, preserve them when they match the chosen direction.
- If images are provided, extract words/pairs you see first (keep order, fix obvious typos).
- Do not invent words not present unless image is unreadable (then note "(unclear in photo)" in example).
- Provide a short example sentence for ~30-60% of items (optional).
`.trim()

    const userText = words
      ? `Direction: ${src} → ${tgt}\n\nInput words/pairs:\n${words}\n\nCreate flashcards translated ${src} → ${tgt}. If a line already includes a correct translation in this direction, keep it.`
      : `Direction: ${src} → ${tgt}\n\nNo typed words provided. Extract a vocabulary list from the image(s) and create flashcards translated ${src} → ${tgt}.`

    const userContent: any[] = [{ type: 'text', text: userText }]

    for (const f of files.slice(0, 6)) {
      const ab = await f.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      const mime = f.type || 'image/png'
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${b64}` },
      })
    }

    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent as any },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })

    const txt = resp.choices?.[0]?.message?.content ?? ''
    const parsed = safeParseJson(txt)
    const normalized = normalize(parsed)
    if (!normalized.language) normalized.language = `${src} → ${tgt}`

    // ✅ SUCCESS -> ONLY NOW consume
    await consumeGeneration(user.id)

    return NextResponse.json(normalized, {
      headers: { 'cache-control': 'no-store', 'x-examly-vocab': 'ok' },
    })
  } catch (e: any) {
    const info = pickErrorInfo(e)
    return NextResponse.json(
      { error: info.message, code: info.code, type: info.type, status: info.status, where: 'api/vocab' },
      { status: info.status, headers: { 'cache-control': 'no-store' } }
    )
  }
}
