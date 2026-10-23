import { describe, expect, it } from "vitest"
import { isPrivateAddress, isPublicUrl } from "./page-render"

// The browser runs on our server with creator-supplied links, so it may only reach public addresses.

describe("page render address guard", () => {
  it("knows private, loopback, link-local, and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ["104.21.40.1", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false)
  })

  it("allows only http(s) URLs whose host resolves to public addresses", async () => {
    const dns: Record<string, string[]> = { "kumpooni.com": ["104.21.40.1"], "rebind.example": ["104.21.40.1", "10.0.0.7"], "metadata.google.internal": ["169.254.169.254"] }
    const resolve = async (h: string) => dns[h] ?? []
    expect(await isPublicUrl("https://kumpooni.com/", resolve)).toBe(true)
    expect(await isPublicUrl("https://rebind.example/", resolve)).toBe(false) // any private answer blocks it
    expect(await isPublicUrl("http://metadata.google.internal/", resolve)).toBe(false)
    expect(await isPublicUrl("http://169.254.169.254/computeMetadata/v1/", resolve)).toBe(false)
    expect(await isPublicUrl("http://localhost:3010/", resolve)).toBe(false)
    expect(await isPublicUrl("file:///etc/passwd", resolve)).toBe(false)
    expect(await isPublicUrl("https://unknown.example/", resolve)).toBe(false) // doesn't resolve
  })
})
