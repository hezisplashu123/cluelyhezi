const sharp = require('sharp');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
async function validate(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Image must be between 1 byte and 10 MB.');
  const decoder = sharp(buffer, { limitInputPixels: 24000000, failOn: 'warning' });
  const info = await decoder.metadata();
  if (!['png', 'jpeg', 'webp'].includes(info.format) || (info.pages || 1) > 1 || !info.width || !info.height || info.width > 10000 || info.height > 10000) throw new Error('Use a still PNG, JPEG, or WebP image up to 24 megapixels and 10000 pixels per side.');
  await decoder.stats(); // Decode actual pixels, rejecting truncated and disguised input.
  return { ...info, mimeType: `image/${info.format}` };
}
module.exports = { validate, MAX_IMAGE_BYTES };
