const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')

const SHEET_ID = process.env.SHEET_ID
const CLIENT_EMAIL = process.env.GS_CLIENT_EMAIL
const PRIVATE_KEY = process.env.GS_PRIVATE_KEY

if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  throw new Error('Missing Google Sheet env vars')
}

function getDoc() {
  const auth = new JWT({
    email: CLIENT_EMAIL,
    key: PRIVATE_KEY.replace(/\\n/g, '\n'),
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
