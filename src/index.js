'use strict'

const protos = require('./protos')
const Id = require('peer-id')
const Peer = require('peer-info')
const defaultNode = new Peer(Id.createFromB58String('Qm')) // TODO: update to production node
defaultNode.multiaddrs.add('/dns/zero.libp2p-nodetrust.tk/tcp/443/wss/ipfs/Qm')
const debug = require('debug')
const log = debug('libp2p:nodetrust')
const multiaddr = require('multiaddr')
const EventEmitter = require('events').EventEmitter

module.exports = class NodeTrustDiscovery extends EventEmitter {
  constructor (config) {
    super()
    this.start = this.start.bind(this)
    this.stop = this.stop.bind(this)
    this.node = config.node || defaultNode
    this.discoveryPeers = config.discoveryPeers || 20
    this.swarm = config.swarm
    this.config = config
  }

  start (cb) {
    this.started = true
    this.interval = setInterval(this._doDiscovery.bind(this), this.config.intervalMS || 1000)
    cb()
  }

  stop (cb) {
    this.started = false
    clearInterval(this.interval || 0)
    cb()
  }

  _doDiscovery (numPeers, cb) {
    log('discovery')
    if (!numPeers) numPeers = this.discoveryPeers
    if (!cb) cb = e => e ? log(e) : false
    this.swarm.dial(this.node, '/nodetrust/discovery/1.0.0', (err, conn) => {
      if (err) return cb(err)
      protos.client(conn, protos.discovery, {
        numPeers
      }, (err, res) => {
        if (err) return cb(err)
        if (!res.success || !res.peers) return cb(new Error('Server did not complete discovery request!'))
        this._handle(res.peers)
        cb(null, res.peers)
      })
    })
  }

  _handle (peers) {
    if (!this.started) return
    peers.forEach(peer => {
      peer.multiaddr.forEach(addr => this.emit('peer', multiaddr(addr).decapsulate('ipfs')))
    })
  }
}
