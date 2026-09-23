export const PictureJPEG = "image/jpeg" as const;
export const PicturePNG = "image/png" as const;
export type PictureContentType = typeof PictureJPEG | typeof PicturePNG;
export const MAX_PICTURE_BYTES = 8_388_608;

export function isPictureContentType(
  value: string,
): value is PictureContentType {
  return value === PictureJPEG || value === PicturePNG;
}

export interface UploadPictureRequest {
  content_type: PictureContentType;
  body: Uint8Array;
}

export function validateUploadPictureRequest(
  request: UploadPictureRequest,
): string[] {
  const fields: string[] = [];
  if (!isPictureContentType(request.content_type)) {
    fields.push("content_type");
  }
  if (
    request.body.byteLength === 0 ||
    request.body.byteLength > MAX_PICTURE_BYTES
  ) {
    fields.push("body");
  }
  return fields;
}
