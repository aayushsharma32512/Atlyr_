// import axios from 'axios';
// import FormData from 'form-data';
// import { config } from '../../config/index';

// export interface NanoBananaRequest {
//   prompt: string;
//   aspectRatio?: string;
//   garment: { buffer: Buffer; mimeType?: string | null; filename?: string };
//   avatar: { buffer: Buffer; mimeType?: string | null; filename?: string };
// }

// export interface NanoBananaResponse {
//   buffer: Buffer;
//   mimeType: string;
//   metadata?: Record<string, unknown>;
// }

// function ensureConfig() {
//   if (!config.NANO_BANANA_API_URL) {
//     throw new Error('missing-nano-banana-url');
//   }
//   if (!config.NANO_BANANA_API_KEY) {
//     throw new Error('missing-nano-banana-api-key');
//   }
// }

// function resolveMimeType(input?: string | null, fallback = 'image/png') {
//   return input && input.trim() ? input.trim() : fallback;
// }

// export async function generateNanoBananaImage(request: NanoBananaRequest): Promise<NanoBananaResponse> {
//   ensureConfig();

//   const form = new FormData();
//   form.append('prompt', request.prompt);
//   form.append('aspect_ratio', request.aspectRatio ?? '9:16');

//   const garmentMime = resolveMimeType(request.garment.mimeType);
//   form.append('garment_image', request.garment.buffer, {
//     contentType: garmentMime,
//     filename: request.garment.filename ?? `garment.${garmentMime.split('/')[1] ?? 'png'}`
//   });

//   const avatarMime = resolveMimeType(request.avatar.mimeType);
//   form.append('avatar_image', request.avatar.buffer, {
//     contentType: avatarMime,
//     filename: request.avatar.filename ?? `avatar.${avatarMime.split('/')[1] ?? 'png'}`
//   });

//   let response;
//   try {
//     // response = await axios.post(config.NANO_BANANA_API_URL, form, {
//       headers: {
//         ...form.getHeaders(),
//         Authorization: `Bearer ${config.NANO_BANANA_API_KEY}`
//       },
//       responseType: 'json',
//       timeout: config.NANO_BANANA_TIMEOUT_S * 1000
//     });
//   } catch (error) {
//     const err = error as Error & { response?: any };
//     const status = err.response?.status;
//     const body = err.response?.data;
//     throw new Error(`nano-banana-request-failed:${status ?? 'unknown'}:${body ? JSON.stringify(body) : err.message}`);
//   }

//   const data = response?.data;
//   if (!data) {
//     throw new Error('nano-banana-empty-response');
//   }

//   let base64: string | undefined;
//   let mimeType: string | undefined;

//   if (typeof data === 'string') {
//     base64 = data;
//   } else if (data?.image?.base64) {
//     base64 = data.image.base64;
//     mimeType = data.image.content_type ?? data.image.mime_type;
//   } else if (Array.isArray(data.images) && data.images.length > 0) {
//     const first = data.images[0];
//     base64 = first?.base64 ?? first?.b64 ?? first?.data;
//     mimeType = first?.mimeType ?? first?.content_type;
//   } else if (data?.base64) {
//     base64 = data.base64;
//     mimeType = data.mimeType ?? data.content_type;
//   }

//   if (!base64) {
//     throw new Error('nano-banana-missing-base64');
//   }

//   const buffer = Buffer.from(base64, 'base64');
//   const resolvedMime = resolveMimeType(mimeType);
//   return {
//     buffer,
//     mimeType: resolvedMime,
//     metadata: data.metadata ?? data
//   };
// }


