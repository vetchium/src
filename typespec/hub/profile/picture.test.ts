import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_PICTURE_BYTES,
  PictureJPEG,
  validateUploadPictureRequest,
} from "./picture.ts";

test("picture envelope enforces content type and byte cap", () => {
  assert.deepEqual(
    validateUploadPictureRequest({
      content_type: PictureJPEG,
      body: new Uint8Array([1]),
    }),
    [],
  );
  assert.deepEqual(
    validateUploadPictureRequest({
      content_type: "image/gif" as typeof PictureJPEG,
      body: new Uint8Array(MAX_PICTURE_BYTES + 1),
    }),
    ["content_type", "body"],
  );
});
