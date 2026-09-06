namespace Vetchium.Hub;

/** A stable, location-neutral Hub user DID encoded as UUIDv7. */
@format("uuid")
scalar HubUserDID extends string;

/** A fixed-width public Hub handle with a readable display-name prefix. */
@minLength(38)
@maxLength(38)
@pattern("^[a-z0-9]{5}-[0-9a-f]{32}$")
scalar HubHandle extends string;
