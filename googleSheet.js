const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')

// Code tự động lấy JSON từ biến môi trường
const SHEET_ID = process.env.SHEET_ID
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS

if (!SHEET_ID || !GOOGLE_CREDENTIALS) {
  throw new Error('Missing env vars: SHEET_ID or GOOGLE_CREDENTIALS')
}

function getDoc() {
  // Tự động parse cục JSON bạn ném vào
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

  return new GoogleSpreadsheet(SHEET_ID, auth)
}

async function readJobs() {
  const doc = getDoc()
  await doc.loadInfo()

  const sheet = doc.sheetsByIndex[0]
  const rows = await sheet.getRows()
  return rows
}

module.exports = {
  readJobs
}
