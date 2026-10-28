const http = require('node:http')

function waitForSupervisorStart(startPromise, timeoutMs = 8000) {
  let timer
  return Promise.race([
    Promise.resolve(startPromise).then(
      (state) => ({ completed: true, state }),
      (error) => ({ completed: true, state: null, error })
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ completed: false, state: null }), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function probeLocalNodeApi({ port, device, token, timeoutMs = 1000 }) {
  const pathname = '/api/devices/' + encodeURIComponent(device) + '/policy'
  return new Promise((resolve) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      headers: { authorization: 'Bearer ' + token }
    }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

async function waitForLocalNodeApi(options, { timeoutMs = 8000, retryMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeLocalNodeApi(options)) return true
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, Math.max(0, deadline - Date.now()))))
  }
  return false
}

module.exports = { waitForSupervisorStart, waitForLocalNodeApi }
