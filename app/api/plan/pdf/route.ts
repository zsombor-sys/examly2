
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const runtime = 'nodejs'

function wrap(text: string, maxChars = 92) {
  const words = String(text ?? '')
    .replace(/\r/g, '')
    .split(/\s+/)
    .filter(Boolean)
  const lines: string[] = []
  let line: string[] = []
  let len = 0
  for (const w of words) {
    const add = (line.length ? 1 : 0) + w.length
    if (len + add > maxChars) {
      lines.push(line.join(' '))
      line = [w]
      len = w.length
    } else {
      line.push(w)
      len += add
    }
  }
  if (line.length) lines.push(line.join(' '))
  return lines.length ? lines : ['']
}

export async function POST(req: Request) {
  try {
    await requireUser(req)

    const { result } = await req.json()

    const pdf = await PDFDocument.create()
    let page = pdf.addPage([612, 792])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

    let y = 760
    const left = 52
    const lineHeight = 14

    const drawLine = (text: string, opts?: { bold?: boolean; size?: number }) => {
      const size = opts?.size ?? 11
      const f = opts?.bold ? bold : font
      if (y < 60) {
        page = pdf.addPage([612, 792])
        y = 760
      }
      page.drawText(text, { x: left, y, size, font: f, color: rgb(0, 0, 0) })
      y -= lineHeight
    }

    const title = String(result?.title ?? 'Examly Notes')
    drawLine(title, { bold: true, size: 16 })
    y -= 6

    const summary = String(result?.quick_summary ?? '')
    if (summary.trim()) {
      drawLine('Quick summary', { bold: true, size: 12 })
      for (const line of wrap(summary)) drawLine(line)
      y -= 6
    }

    const notes = String(result?.study_notes ?? '')
    if (notes.trim()) {
      drawLine('Study notes', { bold: true, size: 12 })
      const chunks = notes.split(/\n+/)
      for (const para of chunks) {
        for (const line of wrap(para)) drawLine(line)
        y -= 4
      }
      y -= 6
    }

    const daily = Array.isArray(result?.daily_plan) ? result.daily_plan : []
    if (daily.length) {
      drawLine('Daily plan', { bold: true, size: 12 })
      for (const d of daily) {
        drawLine(`${d?.day ?? ''} — ${d?.focus ?? ''}`, { bold: true })
        const tasks = Array.isArray(d?.tasks) ? d.tasks : []
        for (const t of tasks.slice(0, 12)) {
          for (const line of wrap(`• ${t}`, 96)) drawLine(line)
        }
        y -= 4
      }
    }

    const bytes = await pdf.save()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="examly-notes.pdf"',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'PDF error' }, { status: (e?.status ?? 400) })
  }
}
