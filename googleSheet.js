const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')

const SHEET_ID = process.env.SHEET_ID
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS

if (!SHEET_ID || !GOOGLE_CREDENTIALS) {
  throw new Error('Missing env vars: SHEET_ID or GOOGLE_CREDENTIALS')
}

async function getDoc() {
  let creds
  try {
    creds = JSON.parse(GOOGLE_CREDENTIALS)
  } catch (e) {
    throw new Error('GOOGLE_CREDENTIALS JSON format is invalid')
  }

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const doc = new GoogleSpreadsheet(SHEET_ID, auth)
  await doc.loadInfo()
  return doc
}

module.exports = {
  getDoc
}
