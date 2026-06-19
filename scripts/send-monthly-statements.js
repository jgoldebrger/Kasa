// Script to send monthly statements via email across all orgs.
// Usage: API_URL=https://yourapp.com CRON_SECRET=... node scripts/send-monthly-statements.js

const https = require('https')
const http = require('http')

const API_URL = process.env.API_URL || 'http://localhost:3000'
const CRON_SECRET = process.env.CRON_SECRET
const API_PATH = '/api/jobs/send-monthly-statements'

function safeLogLine(value) {
  return String(value ?? '').replace(/[\r\n]/g, ' ')
}

if (!CRON_SECRET) {
  console.error('CRON_SECRET env var is required')
  process.exit(1)
}

function sendMonthlyStatements() {
  return new Promise((resolve, reject) => {
    const url = new URL(API_PATH, API_URL)
    const protocol = url.protocol === 'https:' ? https : http

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
    }

    const req = protocol.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✅ Successfully sent monthly statements')
            console.log(`   Sent: ${result.sent}`)
            console.log(`   Failed: ${result.failed}`)
            if (result.month) {
              console.log(`   Month: ${result.month}`)
            }
            if (result.errors && result.errors.length > 0) {
              console.log('   Errors:')
              result.errors.forEach((err) => console.log(`     - ${safeLogLine(err)}`))
            }
            resolve(result)
          } else {
            console.error(
              '❌ Error sending monthly statements:',
              safeLogLine(result.error || JSON.stringify(result)),
            )
            reject(new Error(result.error || 'Failed to send statements'))
          }
        } catch (error) {
          console.error('❌ Error parsing response:', error)
          reject(error)
        }
      })
    })

    req.on('error', (error) => {
      console.error('❌ Request error:', safeLogLine(error.message))
      reject(error)
    })

    req.end()
  })
}

// Run the script
console.log('📧 Starting monthly statement email sending...')
console.log(`   API host: ${safeLogLine(new URL(API_URL).host)}`)
console.log(`   Time: ${new Date().toISOString()}`)

sendMonthlyStatements()
  .then(() => {
    console.log('✅ Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Script failed:', safeLogLine(error.message))
    process.exit(1)
  })
