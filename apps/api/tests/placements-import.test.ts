import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// Pure browser helpers from the dashboard (no DOM needed).
import { PLACEMENT_CSV_TEMPLATE, parseCsv, placementsFromCsv } from '../../web/src/lib/csv.js'
import { zipFiles } from '../../web/src/lib/zip.js'
import { placementSchema } from '../src/lib/schemas.js'

describe('placement CSV import', () => {
  it('parses quotes, escaped quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  })

  it('handles semicolon-separated Excel exports and Arabic text', () => {
    const { rows } = placementsFromCsv('Code;Name;District;Cost (SAR)\nKFR-01;لوحة طريق الملك فهد;العليا;45 000\n')
    expect(rows).toEqual([{ code: 'kfr-01', name: 'لوحة طريق الملك فهد', district: 'العليا', cost_sar: 45000 }])
  })

  it('maps header aliases, blanks to null, and reports unknown columns', () => {
    const { rows, unknownColumns } = placementsFromCsv('bid,placement,lat,lng,cost,owner\nolaya-02,Olaya screen,24.69,46.68,"30,000",JCDecaux\nx-1,,,,,\n')
    expect(rows[0]).toEqual({ code: 'olaya-02', name: 'Olaya screen', latitude: 24.69, longitude: 46.68, cost_sar: 30000 })
    expect(rows[1]).toEqual({ code: 'x-1', name: null, latitude: null, longitude: null, cost_sar: null })
    expect(unknownColumns).toEqual(['owner'])
  })

  it('produces rows the API accepts from the template', () => {
    const { rows } = placementsFromCsv(PLACEMENT_CSV_TEMPLATE)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(placementSchema.safeParse({ ...r, campaign_id: '00000000-0000-4000-8000-000000000001' }).success).toBe(true)
  })

  it('lets the API reject bad numbers with a row error', () => {
    const { rows } = placementsFromCsv('code,name,cost_sar\nok-1,Board,lots\n')
    expect(Number.isNaN(rows[0].cost_sar)).toBe(true)
    expect(placementSchema.safeParse({ ...rows[0], campaign_id: '00000000-0000-4000-8000-000000000001' }).success).toBe(false)
  })
})

describe('QR zip', () => {
  it('builds an archive that unzip can verify, with UTF-8 names', async () => {
    const enc = new TextEncoder()
    const blob = zipFiles([
      { name: 'qr-camp-kfr-01.svg', data: enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>') },
      { name: 'manifest-العليا.csv', data: enc.encode('file,code\n') },
    ])
    const dir = mkdtempSync(join(tmpdir(), 'retrgtr-zip-'))
    try {
      const file = join(dir, 'qr.zip')
      writeFileSync(file, Buffer.from(await blob.arrayBuffer()))
      const out = execFileSync('unzip', ['-t', file]).toString()
      expect(out).toContain('No errors detected')
      expect(execFileSync('unzip', ['-l', file]).toString()).toContain('qr-camp-kfr-01.svg')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
