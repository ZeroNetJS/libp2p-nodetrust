'use strict'

const protos = require('../protos')

const debug = require('debug')
const log = debug('nodetrust:dns')
const {
  waterfall
} = require('async')

const toDNS = {
  ip4: 'A',
  ip6: 'AAAA'
}

module.exports = (swarm, config) => {
  let dnsprov
  const nameRegEx = new RegExp('^ci[a-z0-9]+\\.' + swarm.zone.replace(/\./g, '\\.') + '$', 'mi')
  const {db, dnsDB} = swarm
  db.on('evict', ({key}) => {
    dnsDB.remove(key)
    dnsDB.emit('evict', {key})
  })

  try {
    const DNS = require('./' + config.provider)
    dnsprov = new DNS(swarm, config)
  } catch (e) {
    e.stack = 'Failed to load DNS provider ' + config.provider + ': ' + e.stack
    throw e
  }

  dnsDB.on('evict', ({key}) => {
    log('clear up dns for %s', key)
    swarm.getCN(key, (err, cn) => {
      if (err) return log(err)
      dnsprov.clearDomain(cn, err => err ? log(err) : false)
    })
  })

  let ready = false

  dnsprov.getNames((err, names) => {
    if (err) throw err
    names.filter(n => n.name.match(nameRegEx)).map(n => n.name.split('.').shift()).forEach(id => dnsDB.set(id, true))
    ready = true
    log('dns is ready')
  })

  const handleDNS = (conn, _, cb) => {
    if (!ready) return setTimeout(handleDNS, 500, conn, _, cb)
    setImmediate(() => {
      waterfall([
        cb => conn.getPeerInfo(cb),
        (pi, cb) => {
          const id = pi.id
          log('update dns for %s', id.toB58String())
          if (!db.get(id.toB58String())) return cb(new Error(id.toB58String() + ' has not requested a certificate! Rejecting discovery...'))
          return cb(null, id)
        },
        (id, cb) => {
          swarm.getCN(id, (err, name) => {
            if (err) return cb(err)
            cb(null, name)
          })
        },
        (name, cb) => {
          conn.getObservedAddrs((err, addr) => {
            if (err) return cb(err)
            const ips = addr.map(addr => addr.toString()).filter(addr => addr.startsWith('/ip')).map(addr => {
              const s = addr.split('/')
              return {
                name,
                type: toDNS[s[1]],
                value: s[2]
              }
            })
            cb(null, name, ips)
          })
        },
        (dns, ips, cb) => {
          dnsprov.clearDomain(dns, err => {
            if (err) return cb(err)
            dnsprov.addNames(ips, err => {
              if (err) return cb(err)
              return cb(null, dns)
            })
          })
        }
      ], cb)
    })
  }
  swarm.handle('dns', handleDNS)
}
