// Level T. Compile-only: tsc must exit 0.
// Every @ts-expect-error line asserts that the marked line DOES NOT compile.
import { createMemoryCache, defineSecondparty, SecondpartyError } from '../../src/index.ts'
import type {
  CacheLike,
  Entries,
  Entry,
  EntryContext,
  EntryFunction,
  EntryResult,
  SecondpartyEvent,
  SecondpartyOptions,
} from '../../src/index.ts'

// The spec's consumer shape infers one typed function per key.
const { entries, handle } = defineSecondparty({
  entries: {
    klaviyo: { url: 'https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=XXXX' },
    vimeo: { url: 'https://player.vimeo.com/api/player.js', ttl: 86400 },
  },
  ttl: 3600,
  onEvent: (e: SecondpartyEvent) => void e,
})

// Row 11: an excess entry field fails tsc (Exact constraint).
// @ts-expect-error foo is not part of Entry
defineSecondparty({ entries: { bad: { url: 'https://vendor.example/x.js', foo: 1 } } })

// Unknown keys fail to compile.
// @ts-expect-error nope is not a declared entry
entries.nope

// Entries is readonly.
// @ts-expect-error entry functions cannot be reassigned
entries.klaviyo = entries.vimeo

// The entry function and handler signatures match the spec.
const fn: EntryFunction = entries.klaviyo
const cache: CacheLike = createMemoryCache()
const ctx: EntryContext = { cache }
const result: Promise<EntryResult> = fn(ctx)
const response: Promise<Response> = handle(new Request('https://app.example/__sp/x'), ctx)
void result
void response

// Event union narrows on type.
declare const ev: SecondpartyEvent
if (ev.type === 'fetch') {
  const s: 200 | 304 = ev.status
  void s
}
if (ev.type === 'degraded') {
  const code: 'timeout' | 'status' | 'content_type' | 'network' = ev.error.code
  void code
}

// SecondpartyError fields per spec.
declare const err: SecondpartyError
const key: string = err.key
const status: number | undefined = err.status
void key
void status

// Options and Entries stay exported and usable.
type Opts = SecondpartyOptions<{ a: Entry }>
type Es = Entries<{ a: Entry }>
declare const opts: Opts
declare const es: Es
void opts
void es
