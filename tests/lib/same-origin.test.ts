import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from '@/lib/same-origin';

const req = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe('isSameOriginRequest', () => {
  it('accepts a browser fetch from the site itself', () => {
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin', host: 'the-witness-omega.vercel.app' }))).toBe(true);
  });

  it('refuses a request with no origin information, like a bare curl', () => {
    expect(isSameOriginRequest(req({ host: 'the-witness-omega.vercel.app' }))).toBe(false);
    expect(isSameOriginRequest(req({}))).toBe(false);
  });

  it('refuses cross-site and typed-URL browser requests', () => {
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'cross-site', host: 'a.test' }))).toBe(false);
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-site', host: 'a.test' }))).toBe(false);
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'none', host: 'a.test' }))).toBe(false);
  });

  it('trusts Sec-Fetch-Site over a matching Origin when both are present', () => {
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'cross-site', origin: 'https://a.test', host: 'a.test' }))).toBe(false);
  });

  it('falls back to the Origin header when Sec-Fetch-Site is missing', () => {
    expect(isSameOriginRequest(req({ origin: 'https://a.test', host: 'a.test' }))).toBe(true);
    expect(isSameOriginRequest(req({ origin: 'https://evil.test', host: 'a.test' }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'not a url', host: 'a.test' }))).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'https://a.test' }))).toBe(false);
  });
});
