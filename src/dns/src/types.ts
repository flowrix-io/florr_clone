export interface DnsRecord {
  type: string;
  name: string;
  data: string;
  ttl?: number;
}

export interface DomainOverride {
  domain: string;
  records: DnsRecord[];
}

export interface DnsDatabase {
  overrides: DomainOverride[];
}

export interface DnsServerConfig {
  port: number;
  upstreamDns: string;
  databasePath: string;
}

export interface DnsQuery {
  id: number;
  type: string;
  name: string;
  class: number;
}
