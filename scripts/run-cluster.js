#!/usr/bin/env node
// A sharded game on one machine: a gateway and N simulation servers, kept up.
//
//   node scripts/run-cluster.js [--shards N] [--port P] [--shard-hosts h1,h2,...]
//                               [--server dist/server.js] [-- gateway options]
//
// Each is a process of its own -- which is the point: a Node process
// simulates on one core, and a biome no longer shares it with every other
// biome. Each simulation server takes its own players on a port of its own,
// P+2, P+3, ... (the gateway's own simulation, given `--simulate`, takes its
// players on P): the gateway signs them in and sends them there, and relays
// none of their traffic. Behind Cloudflare, players are never sent to those
// ports: give each shard a proxied hostname of its own that reaches its port
// (a DNS record with an origin rule for the port, or a tunnel), and tell the
// gateway which is which, in the game (`/admin shards domain shard-1
// s1.example.com`, kept in its database) or here, in order, with
// --shard-hosts; they are sent there on the port they already use (443).
// Without them, only players who dial the ports straight can play.
// Any that exits is started again (a server of a sharded game exits to
// be restarted whenever the gateway is updated), with a growing wait if it
// will not stay up. Servers on OTHER machines are not this script's: start
// them there with `--role shard --gateway host:P` (the gateway's game port,
// which takes servers as well as players) and the same secret, and give each
// its domain with `/admin shards domain`.
//
// The secret is FLIX_CLUSTER_SECRET, or one made up for this run; it reaches
// the children by environment, where `ps` does not show it.

const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");

const root = path.resolve(__dirname, "..");
const options = {
  shards: 2,
  port: process.env.PORT || "3000",
  "shard-hosts": "",
  server: path.join(root, "dist", "server.js"),
};
let extra = [];
for (let i = 2; i < process.argv.length; ++i) {
  const arg = process.argv[i];
  if (arg === "--") {
    extra = process.argv.slice(i + 1);
    break;
  }
  const name = arg.replace(/^--/, "");
  if (!(name in options) || i + 1 >= process.argv.length) {
    console.error("usage: run-cluster.js [--shards N] [--port P] [--shard-hosts h1,h2,...] " +
      "[--server file] [-- gateway options]");
    process.exit(2);
  }
  options[name] = process.argv[++i];
}
const shards = Number(options.shards);
// No server is ever given every biome, so one alone could never run them all.
if (!Number.isInteger(shards) || shards < 2) {
  console.error("--shards takes a whole number, 2 or more");
  process.exit(2);
}

const shardHosts = options["shard-hosts"] ? options["shard-hosts"].split(",").map((h) => h.trim()) : [];
if (shardHosts.length !== 0 && shardHosts.length !== shards) {
  console.error(`--shard-hosts names ${shardHosts.length} hosts for ${shards} shards`);
  process.exit(2);
}

const env = Object.assign({}, process.env, {
  FLIX_CLUSTER_SECRET: process.env.FLIX_CLUSTER_SECRET || crypto.randomBytes(32).toString("hex"),
});
// A native server is run as itself; a wasm one by this Node.
const native = !options.server.endsWith(".js");
const command = native ? options.server : process.execPath;
const prefix = native ? [] : [options.server];

const children = new Map();
let stopping = false;

function start(name, args, wait) {
  const began = Date.now();
  const child = spawn(command, prefix.concat(args), { env, stdio: ["ignore", "pipe", "pipe"] });
  children.set(name, child);
  for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines) sink.write(`[${name}] ${line}\n`);
    });
  }
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (stopping) {
      if (children.size === 0) process.exit(0);
      return;
    }
    const next = Date.now() - began > 30000 ? 1000 : Math.min(30000, wait * 2);
    console.error(`[cluster] ${name} exited (${signal || code}); starting it again in ${wait} ms`);
    setTimeout(() => { if (!stopping) start(name, args, next); }, wait);
  });
}

const web = native ? [] : ["--web-root", path.dirname(options.server)];
start("gateway", ["--role", "gateway", "--port", String(options.port), "--shards", String(shards),
  "--db", path.join(path.dirname(options.server), "inventory.json"), ...web, ...extra], 1000);
for (let i = 1; i <= shards; ++i) {
  start(`shard-${i}`, ["--role", "shard", "--shard-name", `shard-${i}`,
    "--port", String(Number(options.port) + 1 + i),
    "--copy", path.join(path.dirname(options.server), `replica-shard-${i}.json`),
    "--gateway", `127.0.0.1:${options.port}`, ...web,
    ...(shardHosts.length ? ["--public-host", shardHosts[i - 1]] : [])], 1000);
}

// The gateway is told first and the servers with it: it calls the rows in,
// they send them, and both exit on their own.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    const gateway = children.get("gateway");
    if (gateway) gateway.kill("SIGTERM");
    setTimeout(() => {
      for (const child of children.values()) child.kill("SIGTERM");
    }, 1500);
    setTimeout(() => process.exit(1), 15000).unref();
  });
}
