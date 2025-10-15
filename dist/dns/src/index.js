"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const DnsServer_1 = require("./DnsServer");
const path = __importStar(require("path"));
const config = {
    port: 53,
    upstreamDns: '8.8.8.8',
    databasePath: path.join(__dirname, '../data/dns-overrides.json')
};
const dnsServer = new DnsServer_1.DnsServer(config);
// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down DNS server...');
    dnsServer.stop();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\nShutting down DNS server...');
    dnsServer.stop();
    process.exit(0);
});
// Start the server
dnsServer.start();
console.log('DNS Server started');
console.log('Press Ctrl+C to stop');
