# Object Storage

Applies to tenant-owned blobs, S3-compatible storage, signed media delivery, and
object lifecycle work.

## Tenant isolation and deployment

- Each tenant owns an isolated SeaweedFS deployment and credentials. Never share
  a bucket, access key, volume, or administrative endpoint across tenants.
- No object store is deployed yet. The first implementation depending on it must
  add the tenant-local master, volume, filer, and authenticated S3 gateway to
  `docker-compose.json`, `docker-compose-ci.json`, the root `Tiltfile`, and every
  `deploy/<tenant>/stack.json`, configuration, secret, health check, and
  persistent-volume definition the topology requires.
- Pin the SeaweedFS image to a reviewed version, never `latest`. Mount data on
  explicit tenant-scoped persistent volumes and document backup and restore
  before treating production objects as durable.
- Enable S3 authentication explicitly. SeaweedFS allows unauthenticated access
  when no identity is configured, so a missing or empty credential configuration
  must fail startup rather than open the store.
- The private S3 write/list/delete endpoint is reachable only from the tenant
  backend network. Never publish administrative, filer, master, volume, metrics,
  profiling, or IAM endpoints to the internet.

## Ownership and references

- The tenant database owns blob metadata and lifecycle state; SeaweedFS owns
  bytes. Use an opaque, unguessable object id and storage key, never a plain or
  publicly derivable handle, DID, email address, or original filename.
- A database row never claims a new object until upload and validation succeed.
  Replacement commits the new reference and a deletion-outbox record for the old
  object in one transaction. A failed database commit schedules cleanup of the
  unreferenced new object.
- Deletion is immediately authoritative in the database. Byte removal is an
  idempotent outbox task retried until confirmed. Sweep unreferenced objects so a
  crash between upload and database commit cannot leak storage forever.
- Deletion events contain only opaque storage identifiers, never user text or
  credentials.
- Profile-picture upload: commit an audited `uploading` row and pending
  idempotency entry before putting bytes. Derive the opaque UUID-shaped object
  key with a tenant-secret HMAC over the owner DID and idempotency key, so a
  retry after a crash finds the same staged object without a predictable key.
  Bind the ledger to the exact content type and source bytes. Bound S3 Put to 30
  seconds; activate the new row, retire the old reference, audit, and complete
  idempotency in one later database transaction. An abandoned staged row expires
  into the retryable deletion queue. Delay every picture-byte deletion by one
  minute, longer than the maximum in-flight Put, since a concurrent replay may
  still be writing after activation, removal, or downgrade. The database
  reference disappears immediately; old signed media URLs expire or fail when
  byte deletion finishes.

## Browser delivery

- Keep buckets private. An authorized API response may contain a short-lived,
  read-only signed URL for one object; a non-predictable key alone is not
  authorization.
- Profile-picture URLs expire after ten minutes and allow only `GET`/`HEAD`.
  Generate them from the picture owner's tenant so remote profile reads return a
  browser-direct URL without proxying bytes through either Hub API.
- Publish only the signed read path, through a tenant-specific HTTPS media
  origin. Keep S3 mutation and listing paths private. Set the storage gateway's
  external host so S3 signature verification uses the browser-visible host.
- Use the pinned MinIO Go S3-compatible client, with separate instances for the
  private write/delete endpoint and the browser-visible read signer. The media
  proxy must preserve the browser Host header (SigV4 signs it; signing an
  internal hostname and rewriting the URL afterward is invalid), admit only
  GET/HEAD on the picture bucket, and reject every mutation, bucket-listing, and
  administrative request.
- Render external media with no credentials and no referrer. A future CDN may
  front the same media origin without changing profile contracts.
- Every region's media origin must appear in the Hub portal's region table
  (`hub-ui/src/app/regions/<environment>.json`). The build generates the
  portal's CSP `img-src` from it, so a remote profile's picture is blocked when
  its home region's origin is missing.
- Replacing or deleting an object rotates the opaque reference. Existing signed
  URLs work only until their short expiry or the delete completes.

## Profile pictures

- Reject the HTTP request before decoding when its body exceeds 8 MiB. Decode
  within the contract's dimension and pixel-count limits, accept only JPEG and
  non-animated PNG, re-encode once in the same format to remove metadata, reject
  a sanitized result above 8 MiB, and discard the original bytes.
- No cropping, resizing, format conversion, or multiple renditions until a
  measured product or performance need justifies them.
- Plan gating and downgrade cleanup follow
  [`hub-subscriptions.md`](hub-subscriptions.md); a free user cannot retain,
  upload, or replace a picture.

## Verification

- Cover oversized bodies before decode, decompression limits, disguised content,
  animation, malformed images, metadata removal, object-store failure, database
  rollback, replacement cleanup, downgrade cleanup, expired and tampered URLs,
  cross-tenant isolation, and retry-safe deletion.
- Deployment tests must prove an omitted or invalid S3 credential does not
  produce anonymous access and no private SeaweedFS port is published.
