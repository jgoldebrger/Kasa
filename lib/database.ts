import mongoose from 'mongoose'

// MongoDB connection string from environment variable (REQUIRED)
const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local')
}

// TypeScript assertion: we've checked above that MONGODB_URI is defined
let MONGODB_URI_STRING: string = MONGODB_URI

// Hosted-deploy safety: strip dev-only TLS bypass flags from the connection
// URI so a copy-paste mistake in `.env` doesn't disable certificate
// validation on Vercel / CI. We gate on platform env vars rather than
// `NODE_ENV === 'production'` so a developer can still `npm run build &&
// npm start` locally (which sets NODE_ENV=production) without losing the
// dev TLS workaround their cluster requires.
const isHostedDeploy =
  process.env.VERCEL === '1' ||
  process.env.CI === 'true' ||
  process.env.KUBERNETES_SERVICE_HOST !== undefined
if (isHostedDeploy) {
  if (/tlsAllowInvalidCertificates=true/i.test(MONGODB_URI_STRING)) {
    console.warn(
      '[database] tlsAllowInvalidCertificates=true detected in hosted MONGODB_URI; stripping it.'
    )
    MONGODB_URI_STRING = MONGODB_URI_STRING.replace(/[?&]tlsAllowInvalidCertificates=true/gi, '')
      .replace(/[?&]$/, '')
  }
  if (/tlsInsecure=true/i.test(MONGODB_URI_STRING)) {
    console.warn(
      '[database] tlsInsecure=true detected in hosted MONGODB_URI; stripping it.'
    )
    MONGODB_URI_STRING = MONGODB_URI_STRING.replace(/[?&]tlsInsecure=true/gi, '')
      .replace(/[?&]$/, '')
  }
}

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  var mongoose: MongooseCache | undefined
}

let cached: MongooseCache = global.mongoose || { conn: null, promise: null }

if (!global.mongoose) {
  global.mongoose = cached
}

async function connectDB() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn
  }

  if (!cached.promise) {
    // Pool size: 10 was a conservative dev default. Under any real concurrency
    // (Vercel functions, multiple in-flight requests per Node process) we
    // were saturating the pool and queueing requests. Drop to a smaller
    // value locally (dev box, hot reload) and lift it for production.
    //
    // Region note: vercel.json pins us to `iad1` (US East, Virginia). For
    // best latency the Atlas cluster MUST live in `us-east-1` (AWS). Each
    // 50ms of cross-region adds up across the dozens of round-trips a
    // request makes; we've measured ~3x p50 regressions on misaligned
    // deploys.
    const isProd = process.env.NODE_ENV === 'production'
    const testDbName = process.env.KASA_TEST_DB_NAME
    const opts = {
      bufferCommands: false,
      maxPoolSize: isProd ? 30 : 10,
      minPoolSize: isProd ? 2 : 0,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      ...(testDbName ? { dbName: testDbName } : {}),
    }

    cached.promise = mongoose.connect(MONGODB_URI_STRING, opts).then((mongoose) => {
      console.log('MongoDB connected successfully')
      // Tear down the cached promise on any subsequent disconnect/error
      // so the next `connectDB()` call rebuilds it instead of returning
      // a stale, broken connection. Without these listeners the module
      // would keep handing back the same dead connection forever after
      // a transient network blip, and every operation would fail until
      // the process restarted.
      const conn = mongoose.connection
      conn.on('disconnected', () => {
        console.warn('[database] MongoDB disconnected; will reconnect on next use.')
        cached.conn = null
        cached.promise = null
      })
      conn.on('error', (err) => {
        console.error('[database] MongoDB connection error:', err?.message || err)
        cached.conn = null
        cached.promise = null
      })
      return mongoose
    }).catch((error) => {
      console.error('MongoDB connection error:', error)
      cached.promise = null
      throw error
    })
  }

  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }

  return cached.conn
}

export default connectDB

