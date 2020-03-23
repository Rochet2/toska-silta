const router = require('koa-router')()
const axios = require('axios')
const FormData = require('form-data')
const DISCORD_HOOK = process.env.DISCORD_HOOK || ''
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || ''
const NodeCache = require('node-cache')
const sentMessageCache = new NodeCache({ stdTTL: 130 })
const sentFileCache = new NodeCache({ stdTTL: 130 })

const hardCodedChannelIds = {
  'GH0TG19L0': 'acual_random'
}

const userMap = {}

const getInfoForSlackUser = async (user) => {
  if (userMap[user]) return userMap[user]
  const { data } = await axios.get(`https://slack.com/api/users.info?token=${SLACK_BOT_TOKEN}&user=${user}`)
  const info = {
    username: data.user.real_name || data.user.name,
    avatar_url: data.user.profile.image_72,
  }
  userMap[user] = info
  return info
}

const sendFileToDiscord = async (url, userInfo) => {
  if (sentFileCache.has(url)) return
  sentFileCache.set(url, true)
  const { data } = await axios.get(url, { responseType: 'stream', headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` } })
  const form = new FormData()
  form.append('username', userInfo.username)
  form.append('avatar_url', userInfo.avatar_url)
  form.append('file', data)
  form.submit(DISCORD_HOOK)
}

const sendMessageToDiscord = async (content, username, avatar_url) => {
  if (sentMessageCache.has(`${content}-${username}`)) return
  sentMessageCache.set(`${content}-${username}`)
  const webhookPayload = {
    username,
    avatar_url,
    content,
  }
  await axios.post(DISCORD_HOOK, webhookPayload)
}

const handleMessage = async (ctx, event) => {
  const { user, text } = event
  const { username, avatar_url } = await getInfoForSlackUser(user)
  if (!text) return ctx.status = 200
  if (username.includes('toska')) return ctx.status = 200
  const content = `${text}`
  await sendMessageToDiscord(content, username, avatar_url)
  ctx.status = 200
}

const handleSlackFile = async (ctx, event) => {
  const { user_id, file_id } = event
  const fileInfoUrl = `https://slack.com/api/files.info?token=${SLACK_BOT_TOKEN}&file=${file_id}`

  const { data: fileData } = await axios.get(fileInfoUrl)
  const userInfo = await getInfoForSlackUser(user_id)
  const actualFileUrl = fileData.file.url_private_download
  await sendFileToDiscord(actualFileUrl, userInfo)

  ctx.status = 200
}

const handleFileShare = async (ctx, event) => {
  const userInfo = await getInfoForSlackUser(event.user)
  await Promise.all(event.files.map(file => {
    const url = file.url_private_download
    return sendFileToDiscord(url, userInfo)
  }))
  ctx.status = 200
}

router.post('/slack/event', async ctx => {
  console.log(ctx.request.body)
  if (ctx.request.body.challenge) {
    ctx.body = ctx.request.body.challenge
    return
  }
  const eventBody = ctx.request.body
  const { channel, type, subtype } = eventBody.event
  if (type === 'file_created') return handleSlackFile(ctx, eventBody.event)
  if (type !== 'message') return ctx.status = 200
  if (subtype === 'file_share') return handleFileShare(ctx, eventBody.event)
  if (subtype === 'bot_message') return ctx.status = 200

  const channelName = hardCodedChannelIds[channel]
  if (!channelName) return ctx.status = 200

  await handleMessage(ctx, eventBody.event)

})

module.exports = router