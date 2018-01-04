# libp2p-nodetrust

Why not give every zeronet node an `ID.node.zeronet.io` address and certificate?

# Why

ZeroNetJS browser support requires ZeroNet node to be dialable from the browser. Which unfortunatly does not work.

The only solution would be to make the browser connect to some websocket-capable nodes.

Problem: HTTP on HTTPS is disabled due to security.

Solution: HTTPS enabled websocket nodes

# How

The ZeroNet client sends the `nodetrust` command to the server along with a privatekey which is an alphanumeric string (from which the Domain Name is derived).

The Server sets up dns and responds with the certificate, key and domain name.

The client launches a wss server with the given certificate and sends the `nodetrustUpdate` command to the server every 4 minutes to keep the DNS entry alive.

# Development

## Client
Run `nodemon index.js -d 1`

## Server
cd into server

Run `bash genca.sh` once

Run `nodemon src/bin.js ./config.dev.json`
