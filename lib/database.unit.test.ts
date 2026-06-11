import { afterEach, describe, expect, it, vi } from 'vitest'

describe('database (unit)', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    delete (global as { mongoose?: unknown }).mongoose
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('throws when MONGODB_URI is missing on connect', async () => {
    const saved = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    vi.resetModules()

    const connectDB = (await import('./database')).default
    await expect(connectDB()).rejects.toThrow(/MONGODB_URI/)

    if (saved !== undefined) process.env.MONGODB_URI = saved
    else delete process.env.MONGODB_URI
    vi.resetModules()
  })

  it('strips tls bypass flags on hosted deploy', async () => {
    process.env.MONGODB_URI =
      'mongodb://u:p@host/db?tlsAllowInvalidCertificates=true&tlsInsecure=true'
    process.env.VERCEL = '1'
    vi.resetModules()

    const mongoose = await import('mongoose')
    const connectSpy = vi
      .spyOn(mongoose.default, 'connect')
      .mockResolvedValue(mongoose.default as never)
    Object.defineProperty(mongoose.default.connection, 'readyState', {
      configurable: true,
      get: () => 0,
    })

    const connectDB = (await import('./database')).default
    await connectDB()
    const uri = connectSpy.mock.calls[0]?.[0] as string
    expect(uri).not.toMatch(/tlsAllowInvalidCertificates/i)
    expect(uri).not.toMatch(/tlsInsecure/i)
  })

  it('clears cached connection on disconnect and error events', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa-test'
    delete process.env.VERCEL
    vi.resetModules()

    const mongoose = await import('mongoose')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
    const fakeConn = {
      readyState: 0,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(handler)
      }),
    }
    const fakeMongoose = {
      connection: fakeConn,
    }

    const connectSpy = vi
      .spyOn(mongoose.default, 'connect')
      .mockResolvedValue(fakeMongoose as never)

    const connectDB = (await import('./database')).default
    await connectDB()

    expect(listeners.disconnected).toHaveLength(1)
    expect(listeners.error).toHaveLength(1)

    listeners.disconnected![0]()
    expect(warnSpy).toHaveBeenCalledWith(
      '[database] MongoDB disconnected; will reconnect on next use.',
    )

    listeners.error![0](new Error('socket reset'))
    expect(errorSpy).toHaveBeenCalledWith(
      '[database] MongoDB connection error:',
      'socket reset',
    )

    warnSpy.mockRestore()
    errorSpy.mockRestore()
    connectSpy.mockRestore()
  })

  it('clears cached promise when connect rejects', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/kasa-test'
    vi.resetModules()

    const mongoose = await import('mongoose')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(mongoose.default, 'connect').mockRejectedValue(new Error('refused'))

    const connectDB = (await import('./database')).default
    await expect(connectDB()).rejects.toThrow('refused')
    await expect(connectDB()).rejects.toThrow('refused')
    expect(mongoose.default.connect).toHaveBeenCalledTimes(2)

    errSpy.mockRestore()
  })
})
