namespace Vetchium;

/** Number of records requested from a keyset-paginated endpoint. */
@minValue(1)
@maxValue(100)
scalar PageSize extends int32;

/** An opaque key that resumes a keyset-paginated request. */
@minLength(1)
@maxLength(4096)
scalar PaginationKey extends string;
