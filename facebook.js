const fs = require('fs')
const fetch = require('node-fetch')
const FormData = require('form-data')

async function postReels(job) {
  // job.VideoFilePath là đường dẫn file video nằm trên máy Github Actions (đã tải về)
  if (!fs.existsSync(job.VideoFilePath)) {
    throw new Error('Video file does not exist on server')
  }

  console.log(`🎬 Start Uploading Reel to Page ${job.PageId}...`)

  const form = new FormData()
  form.append('access_token', job.PageToken)
  form.append('description', job.Caption || '')
  form.append('source', fs.createReadStream(job.VideoFilePath))

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
  if (!job.CommentText && !job.ImageFilePath) return // Không có text cũng ko có ảnh thì nghỉ
  
  console.log(`💬 Commenting on Reel ${job.ReelId}...`)

  const form = new FormData()
  form.append('access_token', job.PageToken)
  
  if (job.CommentText) {
      form.append('message', job.CommentText)
  }

  // Nếu có ảnh thì gửi kèm
  if (job.ImageFilePath && fs.existsSync(job.ImageFilePath)) {
      console.log('🖼️ Uploading comment image...')
      form.append('source', fs.createReadStream(job.ImageFilePath))
  }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${job.ReelId}/comments`,
    {
      method: 'POST',
      body: form
    }
  )
  
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  return json
}

module.exports = { postReels, postComment }

