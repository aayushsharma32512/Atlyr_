/**
 * Gemini model ids. These EXPIRE — Google retires preview models on a rolling
 * basis and the failure is invisible from here: the model keeps appearing in
 * `models.list` with `generateContent` among its supportedGenerationMethods,
 * and only a real call returns
 *   404 "This model ... is no longer available."
 *
 * Verified callable against v1beta on 2 Aug 2026. Four of these were dead:
 *   gemini-3-pro-preview           → retired  (both STAGE1 constants)
 *   gemini-2.0-flash               → retired  (DESC_MODEL)
 *   gemini-2.5-flash-image-preview → not found (IMG_MODEL)
 *
 * If a Gemini-backed function starts failing for no apparent reason, probe the
 * model before anything else — a 404 here surfaces far downstream as
 * NO_CANDIDATES or an empty summary.
 */
export const GARMENT_SUMMARY_VERSION = 'v1.0.0'
export const DESC_MODEL = 'gemini-3.5-flash'
export const IMG_MODEL = 'gemini-3-pro-image'

// gemini-3.1-pro-preview is the direct successor to the retired
// gemini-3-pro-preview — same pro tier, so prompts tuned against it carry over.
export const LIKENESS_STAGE1_MODEL = 'gemini-3.1-pro-preview'
export const LIKENESS_STAGE2_MODEL = 'gemini-3-pro-image'
export const LIKENESS_STAGE2_ASPECT_RATIO = '1:1'
export const LIKENESS_STAGE2_IMAGE_SIZE = '2K'

export const TRYON_STAGE1_MODEL = 'gemini-3.1-pro-preview'
export const TRYON_STAGE1_TEMPERATURE = 0.3
export const TRYON_STAGE1_TOP_K = 1

export const TRYON_STAGE2_MODEL = 'gemini-3-pro-image'
export const TRYON_STAGE2_TEMPERATURE = 0.3
export const TRYON_STAGE2_TOP_K = 1
export const TRYON_STAGE2_ASPECT_RATIO = '1:1'
export const TRYON_STAGE2_IMAGE_SIZE = '2K'


