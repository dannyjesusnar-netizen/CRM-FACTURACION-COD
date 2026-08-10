const { Jimp } = require('jimp');
const jsQR = require('jsqr');

// Lee el contenido codificado dentro de una imagen de QR (el texto real que
// el QR representa, no la imagen en sí). Se usa para verificar si dos fotos
// de QR (Yape y Plin) codifican exactamente el mismo dato — que es como se
// confirma la interoperabilidad real, en vez de asumirla a ciegas.
async function decodificarQr(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const base64 = dataUrl.split(',')[1];
  if (!base64) return null;
  const buffer = Buffer.from(base64, 'base64');
  try {
    const img = await Jimp.read(buffer);
    const { data, width, height } = img.bitmap;
    const resultado = jsQR(new Uint8ClampedArray(data), width, height);
    return resultado ? resultado.data : null;
  } catch (err) {
    return null;
  }
}

module.exports = { decodificarQr };
