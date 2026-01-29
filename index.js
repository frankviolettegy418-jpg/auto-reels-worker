const { getDoc } = require('./googleSheet')
const { postReels, postComment } = require('./facebook')

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  const doc = await getDoc()
  const now = new Date()

  // 1. ĐỌC LOG PROGRESS (Bảng điều phối)
  const logSheet = doc.sheetsByTitle['Log Progress']
  if (!logSheet) throw new Error('Sheet "Log Progress" not found!')
  
  // Chỉ đọc 1000 dòng cuối để tối ưu như mày yêu cầu
  const logs = await logSheet.getRows({ limit: 1000 })
  if (logs.length === 0) {
    console.log('💤 Log Progress is empty.')
    return
  }

  // 2. TÌM JOB CẦN XỬ LÝ (NOW hoặc WAIT tới giờ)
  const jobRow = logs.find(row => {
    const status = row.get('Status')
    const schedule = row.get('ScheduleTime')
    const delayComment = row.get('Delay Comment')
    const commentStatus = row.get('Comment')

    // Ưu tiên 1: Chạy ngay lệnh NOW
    if (status === 'NOW') return true

    // Ưu tiên 2: Chạy lệnh WAIT đã tới giờ
    if (status === 'WAIT' && schedule) {
        // Xử lý ngày tháng format DD/MM/YYYY HH:mm:ss
        const [datePart, timePart] = schedule.split(' ')
        const [day, month, year] = datePart.split('/')
        const targetTime = new Date(`${year}-${month}-${day}T${timePart}`)
        return targetTime <= now
    }

    // Ưu tiên 3: Check Comment (POSTED -> Comment WAIT -> tới giờ)
    if (status === 'POSTED' && commentStatus === 'WAIT' && delayComment) {
        const targetTime = new Date(delayComment) // Format ISO log ghi ra chuẩn rồi
        return targetTime <= now
    }

    return false
  })

  if (!jobRow) {
    console.log('✅ No jobs to run at this time.')
    return
  }

  console.log(`🚀 Found Job at Row ${jobRow.rowNumber} | Status: ${jobRow.get('Status')}`)

  // === XỬ LÝ THÔNG TIN CƠ BẢN ===
  const pageSet = jobRow.get('PageSet') // VD: Page001
  const contentTabName = jobRow.get('Sheet Content') // VD: 01. GiaDung
  const contentSTT = jobRow.get('STT_SheetContent') // VD: 21

  // 3. LẤY TOKEN TỪ SHEET "PAGE_TOKEN"
  const tokenSheet = doc.sheetsByTitle['PAGE_TOKEN']
  const tokenRows = await tokenSheet.getRows()
  const pageInfo = tokenRows.find(r => r.get('PageSet') === pageSet)

  if (!pageInfo) {
    console.error(`❌ Cannot find PageSet "${pageSet}" in PAGE_TOKEN sheet.`)
    return
  }
  
  const pageId = pageInfo.get('Page ID') // Sửa tên cột theo ảnh mày gửi (có dấu cách)
  const pageToken = pageInfo.get('Page Access Token') // Sửa tên cột theo ảnh

  if (!pageId || !pageToken) {
    console.error('❌ Missing Page ID or Token in configuration.')
    return
  }

  // === TRƯỜNG HỢP 1: ĐĂNG REELS (NOW / WAIT) ===
  if (jobRow.get('Status') === 'NOW' || jobRow.get('Status') === 'WAIT') {
    
    // 4. LẤY NỘI DUNG TỪ SHEET CONTENT CỤ THỂ
    const contentSheet = doc.sheetsByTitle[contentTabName]
    if (!contentSheet) {
        console.error(`❌ Content Sheet "${contentTabName}" not found!`)
        return
    }

    // Tìm dòng nội dung theo STT_SheetContent
    const contentRows = await contentSheet.getRows()
    const contentRow = contentRows.find(r => r.get('STT_SheetContent') === contentSTT)

    if (!contentRow) {
        console.error(`❌ Content ID "${contentSTT}" not found in sheet "${contentTabName}"`)
        return
    }

    const caption = contentRow.get('Caption')
    const commentText = contentRow.get('Comment')

    // Chuẩn bị job data
    const jobData = {
        PageId: pageId,
        PageToken: pageToken,
        Caption: caption,
        VideoPath: contentTabName // Giả định tên folder video trùng tên sheet (vd: 01. GiaDung)
    }

    try {
        // GỌI HÀM POST
        const { reelId, reelLink } = await postReels(jobData)
        console.log(`✅ Posted successfully: ${reelLink}`)

        // Cập nhật Log Progress
        jobRow.set('Status', 'POSTED')
        jobRow.set('Link Reels', reelLink)
        // Tính giờ comment (VD: 5-10 phút nữa)
        const delayMin = random(5, 10)
        const commentTime = new Date(now.getTime() + delayMin * 60000)
        jobRow.set('Delay Comment', commentTime.toISOString())
        jobRow.set('Comment', 'WAIT')
        await jobRow.save()

        // Cập nhật Content Sheet -> Đánh dấu DONE
        contentRow.set('Status', 'Done')
        await contentRow.save()
        console.log(`📌 Marked Content ${contentSTT} as Done.`)

    } catch (error) {
        console.error('❌ Posting Failed:', error.message)
    }
  }

  // === TRƯỜNG HỢP 2: COMMENT (WAIT -> DONE) ===
  else if (jobRow.get('Status') === 'POSTED' && jobRow.get('Comment') === 'WAIT') {
    const linkReels = jobRow.get('Link Reels')
    
    // Hack: Lấy ID từ Link (nếu chưa lưu cột ReelId)
    // Link: https://www.facebook.com/123456789
    let reelId = ''
    const match = linkReels.match(/facebook\.com\/(\d+)/) || linkReels.match(/\/reel\/(\d+)/)
    if (match) reelId = match[1]

    if (!reelId) {
        console.error('❌ Could not extract Reel ID for commenting.')
        return
    }

    // Lấy lại nội dung comment (phải đọc lại sheet content vì Log Progress không lưu text comment)
    // Lưu ý: Logic này hơi rườm rà, tốt nhất mày nên lưu luôn nội dung comment vào Log Progress lúc Post
    // Nhưng tao sẽ làm theo logic hiện tại: Đọc lại Content Sheet
    const contentSheet = doc.sheetsByTitle[contentTabName]
    const contentRows = await contentSheet.getRows()
    const contentRow = contentRows.find(r => r.get('STT_SheetContent') === contentSTT)
    const commentText = contentRow ? contentRow.get('Comment') : ''

    if (commentText) {
        try {
            await postComment({
                ReelId: reelId,
                PageToken: pageToken,
                CommentText: commentText
            })
            console.log('✅ Commented successfully.')
            jobRow.set('Comment', 'DONE')
            await jobRow.save()
        } catch (error) {
            console.error('❌ Comment Failed:', error.message)
        }
    } else {
        console.log('⚠️ No comment text found, marking DONE.')
        jobRow.set('Comment', 'DONE')
        await jobRow.save()
    }
  }
}

main().catch(err => {
  console.error('🔥 Critical Error:', err)
  process.exit(1)
})
