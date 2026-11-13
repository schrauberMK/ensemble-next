import http from 'http'
import os from 'os'
import path from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

function waitForServer(child: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 20_000)
    const onData = (chunk: Buffer) => {
      if (chunk.toString('utf8').includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      if (text.includes('EADDRINUSE')) {
        clearTimeout(timer)
        reject(new Error(text))
      }
    })
  })
}

function postLargeBody(port: number): Promise<{ status: number, body: string }> {
  const body = JSON.stringify({ description: 'x'.repeat(1_000_001) })

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/ensemble/teams',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let responseBody = ''
      res.setEncoding('utf8')
      res.on('data', chunk => responseBody += chunk)
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: responseBody }))
    })

    req.on('error', reject)
    req.end(body)
  })
}

function postSplitMultibyte(port: number, totalBytes: number): Promise<number> {
  // A body of exactly totalBytes whose 'ä' (2 bytes) is split across two writes.
  const head = Buffer.from('{"content":"')
  const tail = Buffer.from('ä"}')
  const filler = Buffer.alloc(totalBytes - head.length - tail.length, 'x')
  const body = Buffer.concat([head, filler, tail])
  const split = body.length - 3 // between the two bytes of 'ä'

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/api/ensemble/teams/does-not-exist', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) })
    req.on('error', reject)
    req.write(body.subarray(0, split))
    setTimeout(() => req.end(body.subarray(split)), 50)
  })
}

describe('server body limits', () => {
  // One server for the whole file: starting one per test doubled the startup
  // cost and, under a loaded full run, a second start missed its timeout.
  let child: ChildProcessWithoutNullStreams | undefined
  let port = 0

  beforeAll(async () => {
    port = 38_000 + Math.floor(Math.random() * 2000)
    const dataDir = path.join(os.tmpdir(), `ensemble-server-test-${port}`)
    child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ENSEMBLE_HOST: '127.0.0.1',
        ENSEMBLE_PORT: String(port),
        ENSEMBLE_DATA_DIR: dataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    await waitForServer(child, port)
  }, 25_000)

  afterAll(() => {
    child?.kill('SIGTERM')
    child = undefined
  })

  it('returns 413 for oversized JSON requests', async () => {
    const response = await postLargeBody(port)
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({ error: 'Payload too large' })
  })

  it('counts raw bytes, so a multibyte character split across chunks is not a false 413', async () => {
    // Exactly at the limit: parsed, then 404 for the unknown team. Decoding per
    // chunk made the split 'ä' two U+FFFD (6 bytes) and tipped it over to 413.
    expect(await postSplitMultibyte(port, 1_000_000)).toBe(404)
  })
})
