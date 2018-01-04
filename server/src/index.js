'use strict'

const debug = require('debug')
const log = debug('nodetrust:server')

const TCP = require('libp2p-tcp')
const WS = require('libp2p-websockets')
const Swarm = require('zeronet-swarm')

const Id = require('peer-id')
const Peer = require('peer-info')
const Connection = require('interface-connection').Connection

const protos = require('./protos')

const DB = require('./db')

module.exports = function NodetrustServer (config) {
  const self = this

  if (!config) throw new Error('Config is required')
  if (!config.listen) config.listen = ['/ip4/0.0.0.0/tcp/15566']
  if (!config.listen_ws) config.listen_ws = ['/ip4/0.0.0.0/tcp/15577/ws']
  const keys = ['id', 'zone', 'ca', 'dns', 'discovery']
  keys.forEach(key => {
    if (!config[key]) throw new Error('Config key ' + JSON.stringify(key) + ' missing!')
  })

  log('creating server', config)

  const swarm = self.swarm = new Swarm({
    id: config.id,
    zero: {
      transports: [new TCP()],
      listen: config.listen
    },
    libp2p: {
      transports: [new WS()],
      listen: config.listen_ws
    }
  }, {swarm: {}})

  swarm.zone = config.zone
  swarm.getCN = (id, cb) => {
    if (id.toB58String) id = id.toB58String()
    return protos.buildCN(id, swarm.zone, cb)
  }
  swarm.dbParam = {
    max: 1000000,
    maxAge: config.expire || 5 * 60 * 1000
  }
  swarm.db = new DB(swarm.dbParam)
  swarm.discoveryDB = new DB(swarm.dbParam)
  swarm.dnsDB = new DB(swarm.dbParam)

  swarm.proto = {}

  swarm.handle = (proto, hand) => {
    swarm.proto[proto] = hand
  }

  swarm.exec = (proto, ...args) => swarm.proto[proto](...args)

  require('./ca')(swarm, config.ca)
  require('./dns')(swarm, config.dns)
  require('./discovery')(swarm, config.discovery)
  /* require('./info')(swarm, config) */

  function transform (data, cb) {
    const id = Id.createFromBytes(Buffer.from(data.privkey))
    data._client.getObservedAddrs((err, addr) => {
      if (err) return cb(err)
      const peer = new Peer(id)
      addr.forEach(a => peer.multiaddrs.add(a))
      const conn = new Connection()
      conn.getPeerInfo = cb => cb(null, peer)
      conn.getObservedAddrs = data._client.getObservedAddrs
      return cb(null, peer, conn)
    })
  }

  const handlers = {
    nodetrust: (data, cb) => {
      transform(data, (err, peer, conn) => {
        if (err) return cb(err)
        swarm.exec('ca', conn, data, res => {
          if (!res.success) return cb(null, res)
          swarm.exec('dns', conn, data, (err, dns) => {
            if (err) return cb(null, {success: false})
            swarm.exec('announce', conn, data, err => {
              if (err) return cb(null, {success: false})
              res.dns = dns
              cb(null, res)
            })
          })
        })
      })
    },
    nodetrustUpdate: (data, cb) => {
      transform(data, (err, peer, conn) => {
        if (err) return cb(err)
        swarm.exec('dns', conn, data, err => {
          if (err) return cb(null, {success: false})
          swarm.exec('announce', conn, data, err => {
            if (err) return cb(null, {success: false})
            cb(null, {success: true})
          })
        })
      })
    }
  }

  Object.keys(handlers).forEach(cmd => {
    swarm.protocol.handle(cmd, {
      in: {
        strict: {
          privkey: [Buffer.isBuffer]
        },
        protobuf: {},
        zero_only: true
      },
      out: {
        strict: {
          success: [v => typeof v === 'boolean']
        },
        protobuf: {},
        zero_only: true
      }
    }, handlers[cmd])
  })

  self.start = cb => swarm.start(cb)
  self.stop = cb => swarm.stop(cb)
}
