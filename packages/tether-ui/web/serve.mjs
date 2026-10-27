import { createWebServer } from './server.mjs'

const port = Number(process.env.TETHER_WEB_PORT || 18891)
const controller = process.env.TETHER_CONTROLLER || 'http://127.0.0.1:18890'
const app = createWebServer({ port, controller })
const url = await app.listen()
console.log('Tether WebUI ' + url + '  api -> ' + controller)