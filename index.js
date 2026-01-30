const fs = require('fs')
const path = require('path')
const fetch = require('node-fetch')
const { getDoc } = require('./googleSheet')
const { postReels, postComment } = require('./facebook')

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// --- THÊM HÀM NÀY VÀO ĐÂY ---
function spinText(text) {
  if (!text) return ''
  // Tìm tất cả các đoạn trong dấu {} và random lựa chọn ngăn cách bởi |
  return text.replace(/\{([^}]+)\}/g, (match, group) => {
    const options = group.split('|')
    return options[Math.floor(Math.random() * options.length)]
  })
}

// Hàm tải video từ Link Google Drive về máy
async function downloadVideo(url, destPath) {
  // Regex lấy File ID từ link (link view hoặc link share đều chạy)
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
  const now = new Date()

  // 1. ĐỌC LOG PROGRESS
  const logSheet = doc.sheetsByTitle['Log Progress']
  if (!logSheet) throw new Error('Không tìm thấy sheet "Log Progress"')
  const logs = await logSheet.getRows({ limit: 1000 })
  
  // 2. TÌM JOB CẦN XỬ LÝ (Khớp logic NOW hoặc WAIT)
  const jobRow = logs.find(row => {
    const status = row.get('Status')
    const schedule = row.get('ScheduleTime')
    const delayComment = row.get('Delay Comment')
    const commentStatus = row.get('Comment')

    // Ưu tiên chạy NOW
    if (status === 'NOW') return true
    
    // Chạy WAIT nếu tới giờ
    if (status === 'WAIT' && schedule) {
        const [datePart, timePart] = schedule.split(' ')
        const [day, month, year] = datePart.split('/')
        const targetTime = new Date(`${year}-${month}-${day}T${timePart}`)
        return targetTime <= now
    }
    
    // Chạy Comment nếu tới giờ
    if (status === 'POSTED' && commentStatus === 'WAIT' && delayComment) {
        const targetTime = new Date(delayComment)
        return targetTime <= now
    }
    return false
  })

  if (!jobRow) {
    console.log('✅ Không có Job nào cần chạy lúc này.')
    return
  }

  // Lấy thông tin từ dòng Log tìm được
  const pageSet = jobRow.get('PageSet') 
  const contentTabName = jobRow.get('Sheet Content') // VD: 01. GiaDung
  const contentSTT = jobRow.get('STT_SheetContent') // VD: 21

  console.log(`🚀 Xử lý Job: Row ${jobRow.rowNumber} | Sheet: ${contentTabName} | STT: ${contentSTT}`)

  // 3. TRA CỨU TOKEN TRONG PAGE_TOKEN (Theo tên cột anh đưa)
  const tokenSheet = doc.sheetsByTitle['PAGE_TOKEN']
  if (!tokenSheet) throw new Error('Không tìm thấy sheet "PAGE_TOKEN"')
    
  const tokenRows = await tokenSheet.getRows()
  // So khớp cột PageSet
  const pageInfo = tokenRows.find(r => r.get('PageSet') === pageSet)

  if (!pageInfo) {
    console.error(`❌ Không tìm thấy PageSet "${pageSet}" trong sheet PAGE_TOKEN.`)
    return
  }
  
  // 👉 TÊN CỘT CHÍNH XÁC ANH ĐƯA
  const pageId = pageInfo.get('PageID') 
  const pageToken = pageInfo.get('Token') 

  if (!pageId || !pageToken) {
    console.error(`❌ Thiếu PageID hoặc Token. Kiểm tra lại cột trong PAGE_TOKEN.`)
    return
  }

// === XỬ LÝ ĐĂNG REELS ===
  if (jobRow.get('Status') === 'NOW' || jobRow.get('Status') === 'WAIT') {
    
    // Mở Sheet Content (VD: 01. GiaDung)
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

    // 👉 1. XỬ LÝ RANDOM CAPTION
    const rawCaption = contentRow.get('Caption')
    const caption = spinText(rawCaption) // Random nội dung Caption

    // 👉 2. LẤY VIDEO TỪ DRIVE
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
        
        jobRow.set('Delay Comment', new Date(now.getTime() + random(5, 10) * 60000).toISOString())
        jobRow.set('Comment', 'WAIT')
        await jobRow.save()

        // ❌ ĐÃ BỎ ĐOẠN UPDATE STATUS TRONG SHEET CONTENT

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
        
        // 👉 3. XỬ LÝ RANDOM COMMENT
        const rawComment = contentRow ? contentRow.get('Comment') : ''
        const commentText = spinText(rawComment) // Random nội dung Comment
        
        if (commentText) {
             await postComment({ 
                 ReelId: reelId, 
                 PageToken: pageToken, 
                 CommentText: commentText 
             })
             console.log('✅ Comment thành công.')
        }
        
        // Chỉ cập nhật Log Progress, không động vào Sheet Content
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


