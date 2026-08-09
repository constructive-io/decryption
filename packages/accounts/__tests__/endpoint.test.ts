import { EndpointError, normalizeEndpoint } from '../src';

describe('normalizeEndpoint', () => {
  it('appends the graphql path to a bare host', () => {
    expect(normalizeEndpoint('auth.example.com')).toBe(
      'https://auth.example.com/graphql'
    );
    expect(normalizeEndpoint('https://auth.example.com')).toBe(
      'https://auth.example.com/graphql'
    );
    expect(normalizeEndpoint('https://auth.example.com/')).toBe(
      'https://auth.example.com/graphql'
    );
  });

  it('assumes http for a local host, https otherwise', () => {
    expect(normalizeEndpoint('localhost:3000')).toBe(
      'http://localhost:3000/graphql'
    );
    expect(normalizeEndpoint('127.0.0.1:5555')).toBe(
      'http://127.0.0.1:5555/graphql'
    );
    // the constructive dev planes live on subdomains of localhost
    expect(normalizeEndpoint('auth.localhost:3000')).toBe(
      'http://auth.localhost:3000/graphql'
    );
  });

  it('leaves a url that already names a path alone', () => {
    expect(normalizeEndpoint('  http://auth.localhost:3000/graphql  ')).toBe(
      'http://auth.localhost:3000/graphql'
    );
    expect(normalizeEndpoint('https://example.com/api/v2/gql')).toBe(
      'https://example.com/api/v2/gql'
    );
  });

  it('rejects what cannot be a graphql endpoint', () => {
    expect(() => normalizeEndpoint('  ')).toThrow(EndpointError);
    expect(() => normalizeEndpoint('ftp://example.com')).toThrow(
      /unsupported scheme/
    );
    expect(() => normalizeEndpoint('http://')).toThrow(EndpointError);
  });
});
