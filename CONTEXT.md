# secondparty

Serves third-party static assets (script, style, font) from the app origin through a
runtime proxy, so the browser caches them for a year.

## Language

**Entry**:
One vendor asset the app declares: a key plus a vendor URL.
_Avoid_: Asset, dependency, resource

**Key**:
The name the app gives an entry. Also the first segment of the asset path.
_Avoid_: Id, name, slug

**Vendor**:
The third party that owns and serves the original asset.
_Avoid_: Provider, third party, origin

**Record**:
The cached copy of one entry: decoded bytes, content type, hash, fetched-at time.
_Avoid_: Cache entry, snapshot, copy

**Hash**:
The short content fingerprint of a record's bytes. It sits in the asset path.
_Avoid_: Digest, checksum, version

**Asset path**:
The URL on the app origin that serves a record: `<prefix><key>.<hash>.<ext>`.
_Avoid_: Proxied URL, hashed URL, emitted path

**Prefix**:
The path under which the handler is mounted. Default `/__sp/`.
_Avoid_: Base path, mount point, route

**Handler**:
The web-standard function that answers asset-path requests.
_Avoid_: Proxy route, endpoint, middleware

**Entry function**:
The typed server function for one key. It returns the asset path.
_Avoid_: Loader, getter, resolver

**Config**:
The one server file where the app declares its entries and options.
_Avoid_: Settings, manifest, registry

**Degraded result**:
What an entry function returns when no record is usable: the vendor URL itself.
_Avoid_: Fallback, bypass, passthrough

**Negative record**:
A short-lived marker stored after a vendor error so the next requests do not refetch.
_Avoid_: Error cache, circuit breaker

**Event**:
One notification the core hands the app's `onEvent` hook: a hit, a fetch, a stale serve,
a degraded result, or an error, tagged with its key and its site (render or handler).
_Avoid_: Log, metric, signal, trace

**Single flight**:
One vendor fetch per key per process at a time. A call that arrives during it waits for that
fetch's outcome instead of starting its own.
_Avoid_: Dedupe, coalescing, request collapsing, thundering-herd guard

**Stub vendor**:
A local server in the test suite that plays a vendor with synthetic bodies and chosen fault modes.
_Avoid_: Mock, fake vendor, recorded vendor
