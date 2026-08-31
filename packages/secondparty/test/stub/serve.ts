import { startStubVendor } from './vendor.ts'

const { origin } = await startStubVendor(Number(process.env.SP_STUB_PORT ?? 4567))
console.log(`[stub] listening on ${origin}`)
