const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')

const SHEET_ID = process.env.SHEET_ID
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS

if (!SHEET_ID || !GOOGLE_CREDENTIALS) {
  throw new Error('Missing env vars: SHEET_ID or GOOGLE_CREDENTIALS')
}

function getDoc() {
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

async function readData() {
  const doc = getDoc()
  await doc.loadInfo()

  // Lấy đúng tên Tab (Quan trọng)
  const sheetJobs = doc.sheetsByTitle['Log Progress']
  const sheetTokens = doc.sheetsByTitle['PAGE_TOKEN']

  if (!sheetJobs || !sheetTokens) {
    throw new Error('Không tìm thấy tab "Log Progress" hoặc "PAGE_TOKEN"')
  }

  const jobs = await sheetJobs.getRows()
  const tokens = await sheetTokens.getRows()

  return { jobs, tokens }
}

module.exports = {
  readData
}
