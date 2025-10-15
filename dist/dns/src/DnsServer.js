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
exports.DnsServer = void 0;
const dgram = __importStar(require("dgram"));
const fs = __importStar(require("fs"));
const dns_packet_1 = require("dns-packet");
class DnsServer {
    constructor(config) {
        this.config = config;
        this.database = this.loadDatabase();
        this.server = dgram.createSocket('udp4');
        this.setupServer();
    }
    loadDatabase() {
        try {
            const data = fs.readFileSync(this.config.databasePath, 'utf8');
            return JSON.parse(data);
        }
        catch (error) {
            console.warn(`Could not load database from ${this.config.databasePath}, using empty database`);
            return { overrides: [] };
        }
    }
    setupServer() {
        this.server.on('message', (msg, rinfo) => {
            this.handleDnsQuery(msg, rinfo);
        });
        this.server.on('error', (err) => {
            console.error('DNS Server error:', err);
        });
        this.server.on('listening', () => {
            const address = this.server.address();
            console.log(`DNS Server listening on ${address.address}:${address.port}`);
        });
    }
    async handleDnsQuery(msg, rinfo) {
        try {
            const query = (0, dns_packet_1.decode)(msg);
            const domain = query.questions?.[0]?.name;
            const type = query.questions?.[0]?.type;
            if (!domain || !type) {
                this.sendErrorResponse(msg, rinfo, 1); // Format error
                return;
            }
            console.log(`DNS Query: ${domain} (type: ${type})`);
            // Check for domain override
            const override = this.findDomainOverride(domain);
            if (override) {
                console.log(`Using override for domain: ${domain}`);
                this.sendOverrideResponse(query, override, rinfo);
                return;
            }
            // Proxy to Google DNS
            console.log(`Proxying to Google DNS: ${domain}`);
            await this.proxyToGoogleDns(query, rinfo);
        }
        catch (error) {
            console.error('Error handling DNS query:', error);
            this.sendErrorResponse(msg, rinfo, 2); // Server failure
        }
    }
    findDomainOverride(domain) {
        return this.database.overrides.find(override => {
            // Check for exact match or wildcard
            if (override.domain === domain)
                return true;
            if (override.domain.startsWith('*.')) {
                const wildcardDomain = override.domain.substring(2);
                return domain.endsWith(wildcardDomain);
            }
            return false;
        }) || null;
    }
    sendOverrideResponse(query, override, rinfo) {
        const answers = override.records.map(record => ({
            name: record.name,
            type: record.type.toUpperCase(), // Use string type instead of number
            class: 'IN',
            ttl: record.ttl || 300,
            data: record.data
        }));
        const response = {
            id: query.id,
            type: 'response',
            flags: 0x8180, // Response, recursion available
            questions: query.questions,
            answers: answers
        };
        const responseBuffer = (0, dns_packet_1.encode)(response);
        this.server.send(responseBuffer, rinfo.port, rinfo.address);
    }
    async proxyToGoogleDns(query, rinfo) {
        return new Promise((resolve, reject) => {
            const client = dgram.createSocket('udp4');
            const queryBuffer = (0, dns_packet_1.encode)(query);
            client.on('message', (msg) => {
                // Forward the response back to the original client
                this.server.send(msg, rinfo.port, rinfo.address);
                client.close();
                resolve();
            });
            client.on('error', (err) => {
                console.error('Error proxying to Google DNS:', err);
                this.sendErrorResponse(queryBuffer, rinfo, 2); // Server failure
                client.close();
                reject(err);
            });
            // Send query to Google DNS (8.8.8.8)
            client.send(queryBuffer, 53, this.config.upstreamDns, (err) => {
                if (err) {
                    console.error('Error sending to Google DNS:', err);
                    this.sendErrorResponse(queryBuffer, rinfo, 2);
                    client.close();
                    reject(err);
                }
            });
        });
    }
    sendErrorResponse(query, rinfo, rcode) {
        try {
            const decodedQuery = (0, dns_packet_1.decode)(query);
            const response = {
                id: decodedQuery.id,
                type: 'response',
                flags: 0x8180 | rcode, // Response flag + error code
                questions: decodedQuery.questions || [],
                answers: []
            };
            const responseBuffer = (0, dns_packet_1.encode)(response);
            this.server.send(responseBuffer, rinfo.port, rinfo.address);
        }
        catch (error) {
            console.error('Error sending error response:', error);
        }
    }
    start() {
        this.server.bind(this.config.port);
    }
    stop() {
        this.server.close();
    }
    reloadDatabase() {
        this.database = this.loadDatabase();
        console.log('Database reloaded');
    }
}
exports.DnsServer = DnsServer;
