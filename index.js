const { readData } = require('./googleSheet') // Lưu ý hàm đổi tên thành readData
const { postReels, postComment } = require('./facebook')

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  const now = new Date()
  
  // 1. Đọc cả 2 tab về
  const { jobs, tokens } = await readData()

  if (!jobs.length) {
    console.log('No jobs found in Log Progress')
    return
  }

  // 2. Tìm Job cần chạy
  const job =
    jobs.find(j => j.Status === 'NOW') ||
    jobs.find(j => j.Status === 'WAIT' && new Date(j.ScheduleTime) <= now) ||
    jobs.find(j => j.Status === 'POSTED' && j.Comment === 'WAIT' && new Date(j.DelayComment) <= now)

  if (!job) {
    console.log('No executable job')
    return
  }

  console.log(`Processing Job: ${job.rowNumber} - Status: ${job.Status}`)

  // 3. LOGIC GHÉP DỮ LIỆU (QUAN TRỌNG)
  // Tìm thông tin Page từ tab PAGE_TOKEN dựa vào cột PageSet (VD: Page001)
  const pageInfo = tokens.find(t => t.PageSet === job.PageSet)
  
  if (!pageInfo) {
    console.error(`❌ Không tìm thấy thông tin cho ${job.PageSet} trong tab PAGE_TOKEN`)
    return
  }

  // Gán dữ liệu vào job để facebook.js dùng được
  job.PageId = pageInfo.PageId       // Cột PageId bên tab PAGE_TOKEN
  job.PageToken = pageInfo.PageToken // Cột PageToken bên tab PAGE_TOKEN
  job.VideoPath = job['Sheet Content'] // Map cột Sheet Content thành đường dẫn video
  
  // Kiểm tra an toàn
  if (!job.PageId || !job.PageToken) {
    console.error('❌ Thiếu PageId hoặc PageToken trong tab cấu hình')
    return
  }

  // ===== POST REELS =====
  if (job.Status === 'NOW' || job.Status === 'WAIT') {
    try {
      console.log('Posting Reel...')
      const { reelId, reelLink } = await postReels(job)
      
      console.log('✅ Posted:', reelLink)
      job.Status = 'POSTED'
      job.ReelId = reelId // Lưu vào bộ nhớ tạm để dùng
      job['Link Reels'] = reelLink // Lưu vào cột Link Reels (tên có dấu cách)
      
      // Hẹn giờ comment
      job.DelayComment = new Date(Date.now() + random(5, 10) * 60000).toISOString()
      job.Comment = 'WAIT'
      await job.save()
    } catch (err) {
      console.error('❌ Post Failed:', err.message)
      // Không save lỗi để lần sau chạy lại (hoặc bạn có thể set Status = ERROR)
    }
    return
  }

  // ===== COMMENT =====
  if (job.Status === 'POSTED' && job.Comment === 'WAIT') {
    // Với comment cũng cần ReelId, nếu cột trên sheet tên khác thì phải map lại
    // Giả sử trên sheet bạn chưa có cột ReelId, code sẽ lấy từ job đã load
    // Nhưng nếu chạy lại từ đầu thì cần cột ReelId trên sheet Log Progress để lưu ID bài viết.
    // Tạm thời code này chạy luồng liền mạch.
    
    // Nếu job.ReelId bị thiếu (do load mới), cần đảm bảo bạn có cột lưu ID bài viết trên Sheet
    // Ở file ảnh tôi chưa thấy cột Reel ID, chỉ thấy Link Reels.
    // Facebook API cần ID để comment. Bạn nên thêm cột "ReelId" vào sheet Log Progress.
    
    if(!job.ReelId && job['Link Reels']) {
        // Hack tạm: Lấy ID từ Link nếu có
        // Link: https://www.facebook.com/123456 -> ID 123456
        const match = job['Link Reels'].match(/\/(\d+)/)
        if(match) job.ReelId = match[1]
    }

    if(job.ReelId) {
        await postComment(job)
        job.Comment = 'DONE'
        await job.save()
    } else {
        console.log('Skip Comment: No ReelId found')
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
