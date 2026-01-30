const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const { getDoc } = require('./googleSheet')
const { postReels, postComment } = require('./facebook')

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// --- HÀM XỬ LÝ RANDOM SPIN CONTENT ---
function spinText(text) {
  if (!text) return ''
  return text.replace(/\{([^}]+)\}/g, (match, group) => {
    const options = group.split('|')
    return options[Math.floor(Math.random() * options.length)]
  })
}

// --- HÀM FORMAT NGÀY GIỜ VN (UTC+7) ĐỂ GHI VÀO SHEET ---
function formatDate(date) {
  // Cộng thêm 7 tiếng vào giờ gốc (UTC) để ra giờ VN
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  
  const pad = (num) => num.toString().padStart(2, '0')
  return `${pad(vnTime.getDate())}/${pad(vnTime.getMonth() + 1)}/${vnTime.getFullYear()} ${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())}`
}

// --- HÀM ĐỌC NGÀY GIỜ VN TỪ SHEET VỀ ĐỐI TƯỢNG DATE (UTC) ---
function parseTimeVN(timeStr) {
  if (!timeStr) return null
  // timeStr dạng VN: 30/01/2026 10:00:00
  const [datePart, timePart] = timeStr.split(' ')
  const [day, month, year] = datePart.split('/')
  
  // Tạo Date tạm (Nó sẽ hiểu là 10:00 UTC)
  const tempDate = new Date(`${year}-${month}-${day}T${timePart}`)
  
  // Trừ đi 7 tiếng để về lại UTC chuẩn cho máy tính so sánh
  return new Date(tempDate.getTime() - 7 * 60 * 60 * 1000)
}

// Hàm tải video từ Link Google Drive về máy
async function downloadVideo(url, destPath) {
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
  if (!idMatch) throw new Error('Invalid Google Drive Link')
  const fileId = idMatch[1]
  
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
  
  const res = await fetch(downloadUrl)
  if (!res.ok) throw new Error(`Cannot download video. Status: ${res.statusText}`)
  
  const fileStream = fs.createWriteStream(destPath)
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream)
    res.body.on('error', reject)
    fileStream.on('finish', resolve)
  })
  
  return destPath
}

async function main() {
  const doc = await getDoc()
  // Lấy giờ hiện tại (UTC trên server)
  const now = new Date()

  // 1. ĐỌC CẤU HÌNH TỪ SHEET "Setup GibHub"
  const setupSheet = doc.sheetsByTitle['Setup GibHub']
  let minDelay = 5
  let maxDelay = 10 

  if (setupSheet) {
      const setupRows = await setupSheet.getRows()
      const delayRow = setupRows.find(r => r.get('Setup') === 'Delay Comment')
      if (delayRow) {
          const val = delayRow.get('Delay (phút)')
          if (val && val.includes('-')) {
              const parts = val.split('-')
              minDelay = parseInt(parts[0].trim())
              maxDelay = parseInt(parts[1].trim())
          } else if (val) {
              minDelay = maxDelay = parseInt(val.trim())
          }
      }
  }
  console.log(`⚙️ Cấu hình Delay Comment: ${minDelay} - ${maxDelay} phút`)

  // 2. ĐỌC LOG PROGRESS
  const logSheet = doc.sheetsByTitle['Log Progress']
  if (!logSheet) throw new Error('Không tìm thấy sheet "Log Progress"')
  const logs = await logSheet.getRows({ limit: 1000 })
  
  // 3. TÌM JOB CẦN XỬ LÝ
  const jobRow = logs.find(row => {
    const status = row.get('Status')
    const schedule = row.get('ScheduleTime')
    const delayComment = row.get('Delay Comment')
    const commentStatus = row.get('Comment')

    // Ưu tiên chạy NOW
    if (status === 'NOW') return true
    
    // Chạy WAIT nếu tới giờ (Dùng hàm parseTimeVN đã sửa)
    if (status === 'WAIT' && schedule) {
        const targetTime = parseTimeVN(schedule)
        return targetTime <= now
    }
    
    // Chạy Comment nếu tới giờ (Dùng hàm parseTimeVN đã sửa)
    if (status === 'POSTED' && commentStatus === 'WAIT' && delayComment) {
        const targetTime = parseTimeVN(delayComment)
        return targetTime <= now
    }
    return false
  })

  if (!jobRow) {
    console.log('✅ Không có Job nào cần chạy lúc này.')
    return
  }

  // Lấy thông tin cơ bản
  const pageSet = jobRow.get('PageSet') 
  const contentTabName = jobRow.get('Sheet Content') 
  const contentSTT = jobRow.get('STT_SheetContent') 

  console.log(`🚀 Xử lý Job: Row ${jobRow.rowNumber} | Sheet: ${contentTabName} | STT: ${contentSTT}`)

  // 4. TRA CỨU TOKEN
  const tokenSheet = doc.sheetsByTitle['PAGE_TOKEN']
  if (!tokenSheet) throw new Error('Không tìm thấy sheet "PAGE_TOKEN"')
    
  const tokenRows = await tokenSheet.getRows()
  const pageInfo = tokenRows.find(r => r.get('PageSet') === pageSet)

  if (!pageInfo) {
    console.error(`❌ Không tìm thấy PageSet "${pageSet}" trong sheet PAGE_TOKEN.`)
    return
  }
  
  const pageId = pageInfo.get('PageID') 
  const pageToken = pageInfo.get('Token') 

  if (!pageId || !pageToken) {
    console.error(`❌ Thiếu PageID hoặc Token. Kiểm tra lại cột trong PAGE_TOKEN.`)
    return
  }

  // === XỬ LÝ ĐĂNG REELS ===
  if (jobRow.get('Status') === 'NOW' || jobRow.get('Status') === 'WAIT') {
    
    const contentSheet = doc.sheetsByTitle[contentTabName]
    if (!contentSheet) {
        console.error(`❌ Không tìm thấy sheet nội dung: "${contentTabName}"`)
        return
    }

    const contentRows = await contentSheet.getRows()
    const contentRow = contentRows.find(r => r.get('STT') == contentSTT)

    if (!contentRow) {
        console.error(`❌ Không tìm thấy bài có STT "${contentSTT}" trong sheet "${contentTabName}"`)
        return
    }

    // Random Caption
    const rawCaption = contentRow.get('Caption')
    const caption = spinText(rawCaption)

    // Lấy Video
    const videoLink = contentRow.get('Video Google Driver') 

    if (!videoLink) {
        console.error('❌ Cột "Video Google Driver" bị trống.')
        return
    }

    console.log(`📥 Đang tải video từ Drive: ${videoLink}`)
    const tempVideoPath = path.join(__dirname, `video_temp_${Date.now()}.mp4`)

    try {
        await downloadVideo(videoLink, tempVideoPath)
        console.log('✅ Tải video thành công.')

        const jobData = {
            PageId: pageId,
            PageToken: pageToken,
            Caption: caption,
            VideoFilePath: tempVideoPath
        }

        const { reelId, reelLink } = await postReels(jobData)
        console.log(`✅ Đăng thành công: ${reelLink}`)

        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath)

        // Cập nhật Log Progress
        jobRow.set('Status', 'POSTED')
        jobRow.set('Link Reels', reelLink)
        
        // --- TÍNH GIỜ DELAY COMMENT ---
        // 1. Random số phút delay (VD: 5 phút)
        const minutesToAdd = random(minDelay, maxDelay)
        
        // 2. Cộng vào giờ hiện tại (UTC)
        const delayTimeUTC = new Date(now.getTime() + minutesToAdd * 60000)
        
        // 3. Gọi hàm formatDate (Hàm này sẽ tự cộng thêm 7 tiếng để ra giờ VN đẹp)
        jobRow.set('Delay Comment', formatDate(delayTimeUTC))
        
        jobRow.set('Comment', 'WAIT')
        await jobRow.save()

    } catch (error) {
        console.error('❌ Lỗi khi đăng bài:', error.message)
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath)
    }
  }

  // === XỬ LÝ COMMENT ===
  else if (jobRow.get('Status') === 'POSTED' && jobRow.get('Comment') === 'WAIT') {
    const linkReels = jobRow.get('Link Reels')
    let reelId = ''
    const match = linkReels && (linkReels.match(/facebook\.com\/(\d+)/) || linkReels.match(/\/reel\/(\d+)/))
    if (match) reelId = match[1]

    if (reelId) {
        const contentSheet = doc.sheetsByTitle[contentTabName]
        const contentRows = await contentSheet.getRows()
        const contentRow = contentRows.find(r => r.get('STT') == contentSTT)
        
        // Random Comment
        const rawComment = contentRow ? contentRow.get('Comment') : ''
        const commentText = spinText(rawComment) 
        
        if (commentText) {
             await postComment({ 
                 ReelId: reelId, 
                 PageToken: pageToken, 
                 CommentText: commentText 
             })
             console.log(`✅ Comment thành công: ${commentText}`)
        }
        
        jobRow.set('Comment', 'DONE')
        await jobRow.save()
    } else {
        console.error('❌ Không tìm thấy Reel ID từ link.')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
