// CacheLike is structural: the DOM Cache satisfies it.
import type { CacheLike } from '../../src/index.ts'

declare const domCache: Cache
const c: CacheLike = domCache
void c
