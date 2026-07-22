import { describe, expect, it } from 'vitest'
import { isApartmentsComUrl, isSafePublicHttpUrl } from './url-safety'

describe('isSafePublicHttpUrl', () => {
  it('accepts public http(s) hostnames', () => {
    expect(isSafePublicHttpUrl('https://www.example-apartments.com/floorplans')).toBe(true)
    expect(isSafePublicHttpUrl('http://example.com')).toBe(true)
  })

  it('rejects empty and malformed values', () => {
    expect(isSafePublicHttpUrl(null)).toBe(false)
    expect(isSafePublicHttpUrl('')).toBe(false)
    expect(isSafePublicHttpUrl('not a url')).toBe(false)
    expect(isSafePublicHttpUrl(42)).toBe(false)
  })

  it('rejects non-http schemes', () => {
    expect(isSafePublicHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isSafePublicHttpUrl('ftp://example.com/data')).toBe(false)
    expect(isSafePublicHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects localhost and private/reserved IPs', () => {
    expect(isSafePublicHttpUrl('http://localhost:8000/admin')).toBe(false)
    expect(isSafePublicHttpUrl('http://internal.localhost/x')).toBe(false)
    expect(isSafePublicHttpUrl('http://127.0.0.1/')).toBe(false)
    expect(isSafePublicHttpUrl('http://10.0.0.5/')).toBe(false)
    expect(isSafePublicHttpUrl('http://192.168.1.1/')).toBe(false)
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isSafePublicHttpUrl('http://[::1]/')).toBe(false)
  })

  it('rejects bare internal hostnames and embedded credentials', () => {
    expect(isSafePublicHttpUrl('http://supabase-db/')).toBe(false)
    expect(isSafePublicHttpUrl('https://user:pass@example.com/')).toBe(false)
  })

  it('accepts public IPs', () => {
    expect(isSafePublicHttpUrl('http://93.184.216.34/')).toBe(true)
  })
})

describe('isApartmentsComUrl', () => {
  it('accepts exact apartments.com hostnames', () => {
    expect(isApartmentsComUrl('https://www.apartments.com/some-property/abc123/')).toBe(true)
    expect(isApartmentsComUrl('https://apartments.com/some-property/abc123/')).toBe(true)
  })

  it('rejects substring tricks', () => {
    expect(isApartmentsComUrl('https://evil.com/apartments.com/listing')).toBe(false)
    expect(isApartmentsComUrl('https://apartments.com.evil.com/listing')).toBe(false)
    expect(isApartmentsComUrl('https://notapartments.com/listing')).toBe(false)
  })

  it('rejects unsafe urls', () => {
    expect(isApartmentsComUrl('file://apartments.com/x')).toBe(false)
    expect(isApartmentsComUrl(null)).toBe(false)
  })
})
