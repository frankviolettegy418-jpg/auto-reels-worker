const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const FormData = require('form-data')

async function postReels(job) {
  // VideoPath sẽ là tên folder tương ứng với "Sheet Content" (vd: 01. GiaDung)
  // Đảm bảo mày đã upload folder "01. GiaDung" chứa video .mp4 lên GitHub
  const videoDir = path.join(__dirname, job.VideoPath)

  if (!fs.existsSync(videoDir)) {
    throw new Error(`Video folder not found: ${videoDir}`)
  }

  const videos = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'))
  if (!videos.length) throw new Error(`No mp4 files in folder: ${videoDir}`)

  // Random 1 video trong folder đó
  const file = videos[Math.floor(Math.random() * videos.length)]
  console.log(`🎬 Uploading video: ${file}`)

  const form = new FormData()
  form.append('access_token', job.PageToken)
  form.append('description', job.Caption || '')
  form.append('source', fs.createReadStream(path.join(videoDir, file)))

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${job.PageId}/videos`,
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
  if (!job.CommentText) {
    console.log('⚠️ No comment text provided, skipping.')
    return
  }

  console.log(`💬 Commenting on Reel ID: ${job.ReelId}`)
  
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${job.ReelId}/comments`,
    {
      method: 'POST',
      body: new URLSearchParams({
        access_token: job.PageToken,
        message: job.CommentText
      })
    }
  )
  
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

module.exports = {
  postReels,
  postComment
}
