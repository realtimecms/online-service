const http = require('http')
const ReactiveDao = require("@live-change/dao")
const ReactiveDaoWebsocket = require("@live-change/dao-websocket")
const ReactiveServer = ReactiveDao.ReactiveServer
const WebSocketServer = require('websocket').server

const App = require("@live-change/framework")
const validators = require("../validation")
const app = new App()

const definition = app.createServiceDefinition({
  name: 'online',
  validators
})

const eventDelay = 2000
const cacheDelay = 5000

async function sendOnlineEvent(path) {
  const type = path[0]
  try {
    if(type == 'object') {
      const group = path[1]
      await app.trigger({
        type: `${group}Online`,
        parameters: path.slice(2)
      })
    } else if(type == 'user') {
      const group = path[2]
      await app.trigger({
        type: `user${group ? group.slice(0, 1).toUpperCase() + group.slice(1) : ''}Online`,
        user: path[1],
        parameters: path.slice(3)
      })
    } else if(type == 'session') {
      const group = path[2]
      await app.trigger({
        type: `session${group ? group.slice(0, 1).toUpperCase() + group.slice(1) : ''}Online`,
        session: path[1],
        parameters: path.slice(3)
      })
    }
  } catch(error) {
    console.error("ONLINE EVENT ERROR")
  }
}

async function sendOfflineEvent(path) {
  const type = path[0]
  try {
    if(type == 'object') {
      const group = path[1]
      await app.trigger({
        type: `${group}Offline`,
        parameters: path.slice(2)
      })
    } else if(type == 'user') {
      const group = path[2]
      await app.trigger({
        type: `user${group ? group.slice(0, 1).toUpperCase() + group.slice(1) : ''}Offline`,
        user: path[1],
        parameters: path.slice(3)
      })
    } else if(type == 'session') {
      const group = path[2]
      await app.trigger({
        type: `session${group ? group.slice(0, 1).toUpperCase() + group.slice(1) : ''}Offline`,
        session: path[1],
        parameters: path.slice(3)
      })
    }
  } catch(error) {
    console.error("ONLINE EVENT ERROR")
  }
}

async function sendAllOfflineEvent() {
  console.log("SEND ALL OFFLINE EVENT")
  await app.trigger({
    type: `allOffline`
  })
}

const selfObservables = new Map()

class SelfObservable extends ReactiveDao.Observable {
  constructor(path) {
    super()
    this.path = path
    this.disposeTimeout = null
    this.onlineEventTimeout = null
    this.offlineEventTimeout = null
    this.lastEvent = null

    console.log("PATH", this.path, "IS ONLINE")
    this.setOnlineEventTimeout()
  }
  setOnlineEventTimeout() {
    if(this.lastEvent == 'online') return
    this.onlineEventTimeout = setTimeout(() => {
      sendOnlineEvent(this.path)
      this.lastEvent = 'online'
      this.onlineEventTimeout = null
    }, eventDelay)
  }
  setOfflineEventTimeout() {
    if(this.lastEvent == 'offline') return
    this.offlineEventTimeout = setTimeout(() => {
      sendOfflineEvent(this.path)
      this.lastEvent = 'offline'
      this.offlineEventTimeout = null
    }, eventDelay)
  }
  clearOnlineEventTimeout() {
    if(this.onlineEventTimeout) {
      clearTimeout(this.onlineEventTimeout)
      this.onlineEventTimeout = null
    }
  }
  clearOfflineEventTimeout() {
    if(this.offlineEventTimeout) {
      clearTimeout(this.offlineEventTimeout)
      this.offlineEventTimeout = null
    }
  }
  observe(observer) {
    if(this.isDisposed()) this.respawn()
    this.observers.push(observer)
    this.fireObserver(observer, 'set', this.observers.length)
  }
  unobserve(observer) {
    console.log("UNOBSERVED")
    this.observers.splice(this.observers.indexOf(observer), 1)
    this.fireObservers('set', this.observers.length)
    if(this.isUseless()) this.dispose()
  }
  dispose() {
    this.disposed = true
    console.log("PATH", this.path, "IS OFFLINE")
    this.disposeTimeout = setTimeout(() => {
      if(this.disposed) {
        selfObservables.delete(JSON.stringify(this.path))
      }
    }, cacheDelay)
    this.clearOnlineEventTimeout()
    this.setOfflineEventTimeout()
  }
  respawn() {
    if(this.disposeTimeout) {
      clearTimeout(this.disposeTimeout)
      this.disposeTimeout = null
    }
    this.disposed = false
    this.clearOfflineEventTimeout()
    this.setOnlineEventTimeout()
    console.log("PATH", this.patch, "IS ONLINE AGAIN")
  }
}

function getSelfObservable(path) {
  let observable = selfObservables.get(JSON.stringify(path))
  if(observable) return observable
  observable = new SelfObservable(path)
  selfObservables.set(JSON.stringify(path), observable)
  return observable
}

const onlineDao = {
  observable([type, ...path]) {
    console.log("OBSERVABLE", type, path)
    if(type!='online') throw new Error("not found")
    return getSelfObservable(path)
  },
  get([type, ...path]) {
    console.log("GET", type, path)
    if(type!='online') throw new Error("not found")
    let observable = selfObservables.get(path)
    return observable ? observable.observers.length : 0
  },
  dispose() {

  }
}

const createDao = (clientSessionId) => {
  console.log("ONLINE SERVICE DAO")
  return onlineDao
}

module.exports = definition

async function start() {
  app.processServiceDefinition(definition, [ ...app.defaultProcessors ])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({
  }))*/

  await sendAllOfflineEvent()

  const reactiveServer = new ReactiveServer(createDao)

  const port = process.env.ONLINE_PORT || 8071

  const httpServer = http.createServer() // TODO: pure HTTP API
  httpServer.listen(port)

  let wsServer = new WebSocketServer({httpServer, autoAcceptConnections: false})
  wsServer.on("request",(request) => {
    let serverConnection = new ReactiveDaoWebsocket.server(request)
    reactiveServer.handleConnection(serverConnection)
  })

  console.log(`server started at localhost:${port}`)
}

if (require.main === module) start().catch( error => { console.error(error); process.exit(1) })

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})
