# DNS Server with Domain Overrides

A TypeScript DNS server that proxies Google DNS by default but can override specific domains using a JSON database.

## Features

- **DNS Proxy**: Forwards queries to Google DNS (8.8.8.8) by default
- **Domain Overrides**: Override specific domains with custom DNS records
- **Wildcard Support**: Support for wildcard domains (e.g., `*.dev.local`)
- **Multiple Record Types**: Support for A, AAAA, CNAME, MX, TXT, NS, SOA, PTR records
- **Hot Reload**: Database can be reloaded without restarting the server
- **TypeScript**: Fully typed implementation

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

## Usage

### Running the Server

```bash
# Development mode (with ts-node)
npm run dev

# Production mode
npm start
```

The server will start on port 53 by default. You may need to run with sudo on Linux/macOS:

```bash
sudo npm start
```

### Configuration

The server configuration is defined in `src/index.ts`:

```typescript
const config: DnsServerConfig = {
  port: 53,                    // DNS server port
  upstreamDns: '8.8.8.8',      // Google DNS server
  databasePath: 'path/to/dns-overrides.json'  // Path to override database
};
```

### Domain Overrides

Domain overrides are defined in the JSON database file (`data/dns-overrides.json`):

```json
{
  "overrides": [
    {
      "domain": "example.local",
      "records": [
        {
          "type": "A",
          "name": "example.local",
          "data": "127.0.0.1",
          "ttl": 300
        }
      ]
    },
    {
      "domain": "*.dev.local",
      "records": [
        {
          "type": "A",
          "name": "*.dev.local",
          "data": "127.0.0.1",
          "ttl": 300
        }
      ]
    }
  ]
}
```

#### Supported Record Types

- **A**: IPv4 address (e.g., "192.168.1.1")
- **AAAA**: IPv6 address (e.g., "::1")
- **CNAME**: Canonical name (e.g., "www.example.com")
- **MX**: Mail exchange (e.g., "10 mail.example.com")
- **TXT**: Text record (e.g., "v=spf1 include:_spf.google.com ~all")
- **NS**: Name server (e.g., "ns1.example.com")
- **SOA**: Start of authority
- **PTR**: Pointer record (for reverse DNS)

#### Wildcard Domains

Use `*.domain.com` to match any subdomain. For example:
- `*.dev.local` matches `api.dev.local`, `test.dev.local`, etc.

### Testing the Server

You can test the DNS server using various tools:

#### Using dig (Linux/macOS)
```bash
# Test a regular domain (should proxy to Google DNS)
dig @127.0.0.1 google.com

# Test an overridden domain
dig @127.0.0.1 example.local
```

#### Using nslookup
```bash
# Test a regular domain
nslookup google.com 127.0.0.1

# Test an overridden domain
nslookup example.local 127.0.0.1
```

#### Using Node.js
```javascript
const dns = require('dns');

// Set the DNS server
dns.setServers(['127.0.0.1']);

// Test queries
dns.resolve4('google.com', (err, addresses) => {
  console.log('Google.com:', addresses);
});

dns.resolve4('example.local', (err, addresses) => {
  console.log('Example.local:', addresses);
});
```

## Development

### Project Structure

```
src/
├── index.ts          # Main entry point
├── DnsServer.ts      # DNS server implementation
└── types.ts          # TypeScript type definitions

data/
└── dns-overrides.json # Domain override database

dist/                 # Compiled JavaScript (after build)
```

### Building

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

## API Reference

### DnsServer Class

#### Constructor
```typescript
new DnsServer(config: DnsServerConfig)
```

#### Methods
- `start()`: Start the DNS server
- `stop()`: Stop the DNS server
- `reloadDatabase()`: Reload the domain override database

### Types

#### DnsServerConfig
```typescript
interface DnsServerConfig {
  port: number;
  upstreamDns: string;
  databasePath: string;
}
```

#### DomainOverride
```typescript
interface DomainOverride {
  domain: string;
  records: DnsRecord[];
}
```

#### DnsRecord
```typescript
interface DnsRecord {
  type: string;
  name: string;
  data: string;
  ttl?: number;
}
```

## Security Considerations

- The server runs on port 53 by default, which requires root privileges on most systems
- Consider running behind a firewall or in a controlled environment
- Validate and sanitize domain override data to prevent injection attacks
- Monitor DNS query logs for suspicious activity

## License

MIT
