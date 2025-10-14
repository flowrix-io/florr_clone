#!/usr/bin/env node

import * as dns from 'dns';

// Test script to demonstrate DNS server functionality
async function testDnsServer() {
  console.log('Testing DNS Server...\n');

  // Set DNS server to localhost
  dns.setServers(['127.0.0.1']);

  const testDomains = [
    'example.local',      // Should be overridden
    'test.local',         // Should be overridden
    'api.dev.local',      // Should match wildcard
    'google.com',         // Should proxy to Google DNS
    'github.com'          // Should proxy to Google DNS
  ];

  for (const domain of testDomains) {
    try {
      console.log(`Testing: ${domain}`);
      
      // Test A record
      const addresses = await new Promise<string[]>((resolve, reject) => {
        dns.resolve4(domain, (err, addresses) => {
          if (err) reject(err);
          else resolve(addresses);
        });
      });
      
      console.log(`  A: ${addresses.join(', ')}`);
      
      // Test AAAA record if available
      try {
        const addresses6 = await new Promise<string[]>((resolve, reject) => {
          dns.resolve6(domain, (err, addresses) => {
            if (err) reject(err);
            else resolve(addresses);
          });
        });
        console.log(`  AAAA: ${addresses6.join(', ')}`);
      } catch (err) {
        // AAAA records might not exist, that's okay
      }
      
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
    
    console.log('');
  }
}

// Run the test
testDnsServer().catch(console.error);
