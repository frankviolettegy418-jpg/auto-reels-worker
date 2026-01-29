const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const FormData = require('form-data')

const pick = arr => arr[Math.floor(Math.random() * arr.length)]

function parseRandomText(text = '') {
  return text.replace(/\{([^}]+)\}/g, (_, g) =>
    pick(g.split('|'))
  )
}

async function postReels(job) {
  if (!fs.existsSync(job.VideoPath)) {
    throw new Error('Video folder not found')
  }

  const videos = fs.readdirSync(job.VideoPath).filter(f => f.endsWith('.mp4'))
  if (!videos.length) throw new Error('No mp4 file')

  const file = pick(videos)
  const caption = parseRandomText(job.Caption || '')

  const form = new FormData()
  form.append('access_token', job.PageToken)
  form.append('description', caption)
  form.append('source', fs.createReadStream(path.join(job.VideoPath, file)))

  const res = await fetch(
    `https://graph.facebook.com/v24.0/${job.PageId}/videos`,
    { method: 'POST', body: form }
  )

  const json = await res.json()
  if (json.error) throw new Error(json.error.message)

  return {
    reelId: json.id,
    reelLink: `https://www.facebook.com/${json.id}`
  }
}

async function postComment(job) {
  if (!job.CommentText) return

  const text = parseRandomText(job.CommentText)

  await fetch(
    `https://graph.facebook.com/v24.0/${job.ReelId}/comments`,
    {
      method: 'POST',
      body: new URLSearchParams({
        access_token: job.PageToken,
        message: text
      })
    }
  )
}

module.exports = {
  postReels,
  postComment
}
