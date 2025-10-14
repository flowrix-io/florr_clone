import { DnsServer } from './DnsServer';
import { DnsServerConfig } from './types';
import * as path from 'path';

const config: DnsServerConfig = {
  port: 53,
  upstreamDns: '8.8.8.8',
  databasePath: path.join(__dirname, '../data/dns-overrides.json')
};

const dnsServer = new DnsServer(config);

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
