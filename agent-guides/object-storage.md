# Object Storage

Applies to tenant-owned blobs, SeaweedFS, signed media delivery, object
lifecycle, and profile-picture and Org logo storage.

## Tenant isolation and deployment

- Each tenant has its own SeaweedFS master, volume, filer, and authenticated S3
  gateway, plus an nginx media proxy, with its own credentials, volumes, and
  networks. Never share a bucket, access key, volume, or administrative endpoint
  across tenants.
- A new tenant or topology change updates `docker-compose.json`,
  `docker-compose-ci.json`, the root `Tiltfile`, and every
  `deploy/<tenant>/stack.json`, with their configuration, secrets, health
  checks, and persistent volumes.
  `backend/internal/appconfig/object_storage_topology_test.go` checks the
  topology and media-proxy isolation.
- Pin the SeaweedFS image by version and digest, never `latest`. Keep data on
  tenant-scoped persistent volumes; backup and restore are in
  `deploy/README.md`.
- SeaweedFS allows anonymous access when no identity is configured, so the S3
  gateway refuses to start on a missing or unsafe credential file
  (`dev/seaweedfs-s3-entrypoint.sh`).
- The S3 write/list/delete endpoint is reachable only on the tenant backend
  network. Never publish administrative, filer, master, volume, metrics,
  profiling, or IAM endpoints.

## Ownership and references

- **PROF-PIC-006** The tenant database owns blob metadata and lifecycle state;
  the tenant's SeaweedFS owns the bytes. Use an opaque, unguessable object id
  and storage key, never a handle, DID, email address, original filename, or
  other derivable value.
- A row never claims an object until upload and validation succeed.
  Replacement commits the new reference and a deletion-outbox record for the old
  object in one transaction. A failed commit schedules cleanup of the
  unreferenced new object.
- Deletion is authoritative in the database at once. Byte removal is an
  idempotent outbox task retried until confirmed. Sweep unreferenced objects so
  a crash between upload and commit cannot leak storage.
- Deletion events carry only opaque storage identifiers, never user text or
  credentials.

## Profile-picture upload lifecycle

- Commit an audited `uploading` row and a pending idempotency entry before
  putting bytes.
- Derive the UUID-shaped object key with a tenant-secret HMAC over the owner DID
  and idempotency key, so a retry after a crash finds the same staged object
  without a predictable key. Bind the ledger to the exact content type and
  source bytes.
- Bound the S3 Put to 30 seconds. In one later transaction, activate the new
  row, retire the old reference, audit, and complete idempotency.
- Both transactions lock the owner row in their own statement before reading
  picture rows, so concurrent uploads serialize and the later one supersedes
  the earlier staged row.
- An abandoned staged row expires into the retryable deletion queue.
- Delay every picture-byte deletion by one minute, longer than the maximum
  in-flight Put — a concurrent replay may still be writing after activation,
  removal, or downgrade. The database reference disappears at once; old signed
  URLs expire or fail when byte deletion finishes.

## Browser delivery

- Keep buckets private. An authorized API response may carry a short-lived,
  read-only signed URL for one object; an unguessable key alone is not
  authorization.
- Profile-picture URLs expire after ten minutes and allow only `GET` and `HEAD`.
  Sign them in the picture owner's tenant, so a remote profile read returns a
  browser-direct URL and no Hub API proxies bytes.
- Publish only the signed read path, through a tenant-specific HTTPS media
  origin. Set the storage gateway's external host so signature verification
  uses the browser-visible host.
- Use the pinned MinIO Go client (`backend/internal/objectstorage`), with
  separate instances for the private write/delete endpoint and the
  browser-visible read signer.
- The media proxy preserves the browser `Host` header — SigV4 signs it, so
  signing an internal host and rewriting the URL is invalid. It admits only
  `GET`/`HEAD` on the picture bucket and rejects mutation, listing, and
  administrative requests.
- Render external media with no credentials and no referrer. A CDN may later
  front the same media origin without changing profile identity, contracts, or
  object ownership.
- List every region's media origin in
  `hub-ui/src/app/regions/<environment>.json`. The build generates the portal's
  CSP `img-src` from it, so a missing origin blocks that region's pictures.
- Replacing or deleting an object rotates the opaque reference. Existing signed
  URLs work only until their expiry or the delete completes.

## Profile pictures

- **PROF-PIC-001** A user on `hub-silver-tier` or higher may add, replace, and
  remove a picture; a lower plan cannot upload or replace one and gets
  `hub-plan-required`. Removal is open to every plan. Downgrade cleanup follows
  [`hub-subscriptions.md`](hub-subscriptions.md); a later upgrade needs a new
  upload.
- **PROF-PIC-003** Reject a body above 8 MiB (8,388,608 bytes) with
  `hub-profile-picture-too-large` before decoding. Accept only decoded JPEG and
  non-animated PNG (`image/jpeg`, `image/png`); check for APNG chunks, which the
  standard decoder ignores.
- **PROF-PIC-004** Both dimensions are at least 400 pixels; the longest at most
  7,680, the shortest at most 4,320, and the total at most 33,177,600 pixels.
  Decode within these limits.
- **PROF-PIC-005** Re-encode once in the same format to strip metadata, reject a
  sanitized result above 8 MiB, and discard the source bytes.
- Store one rendition: no cropping, resizing, format conversion, or responsive
  variants until a measured need justifies them.

## Org logos

- Silver and above, in the separate `org-logos` bucket of the same tenant
  gateway; orgs-api and workers hold the S3 credentials, and the media proxy
  serves `hub-profile-pictures` and `org-logos` paths.
- The lifecycle is the profile picture's: staged `uploading` row with an
  idempotency-ledger entry, HMAC object id, 30 s Put, activation that retires
  the old object, one-minute delayed retryable deletion, signed ten-minute
  `GET`/`HEAD` URL from `my-info`.
- Only the limits differ: PNG or JPEG, each side 128 to 4096 pixels, at most
  2 MiB, sanitized by the shared `internal/imagesanitize` with the limits as a
  parameter. Downgrading below Silver removes the reference in the
  subscription transition ([`org-subscriptions.md`](org-subscriptions.md)).

## Verification

- Cover oversized bodies before decode, decompression limits, disguised
  content, animation, malformed images, metadata removal, object-store failure,
  database rollback, replacement cleanup, downgrade cleanup, expired and
  tampered URLs, cross-tenant isolation, and retry-safe deletion.
- Deployment tests prove an omitted or invalid S3 credential gives no anonymous
  access and no private SeaweedFS port is published.
