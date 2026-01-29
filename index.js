const { readJobs } = require('./googleSheet')
const { postReels, postComment } = require('./facebook')

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function main() {
  const now = new Date()
  const jobs = await readJobs()

  if (!jobs.length) {
    console.log('No jobs')
    return
  }

  const job =
    jobs.find(j => j.Status === 'NOW') ||
    jobs.find(j => j.Status === 'WAIT' && new Date(j.ScheduleTime) <= now) ||
    jobs.find(j => j.Status === 'POSTED' && j.Comment === 'WAIT' && new Date(j.DelayComment) <= now)

  if (!job) {
    console.log('No executable job')
    return
  }

  // ===== POST REELS =====
  if (job.Status === 'NOW' || job.Status === 'WAIT') {
    const { reelId, reelLink } = await postReels(job)

    job.Status = 'POSTED'
    job.ReelId = reelId
    job.LinkReels = reelLink
    job.DelayComment = new Date(Date.now() + random(5, 10) * 60000).toISOString()
    job.Comment = 'WAIT'
    await job.save()
    return
  }

  // ===== COMMENT =====
  if (job.Status === 'POSTED' && job.Comment === 'WAIT') {
    await postComment(job)
    job.Comment = 'DONE'
    await job.save()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
