// Búsqueda "tolerante" de productos: en la práctica el vendedor casi nunca
// escribe el nombre exacto como quedó registrado (le cambia el orden a las
// palabras, se le va una tilde, escribe "yogurt" en vez de "yogur", o deja
// afuera una palabra) — una búsqueda de un solo LIKE %texto% contra el
// nombre completo falla en todos esos casos. Esto no usa ningún servicio de
// IA (serían costos por búsqueda); es solo texto normalizado + comparación
// por palabras, corriendo en el propio backend.

// Minúsculas, sin tildes/diéresis, y solo letras/números separados por
// espacios — para que "Yogurt Descremado" y "yogur descremado" comparen igual.
function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Distancia de edición (Levenshtein) clásica — cuántos cambios de una letra
// hacen falta para pasar de una palabra a otra. Sirve para tolerar errores
// de tipeo pequeños sin necesitar nada externo.
function distanciaLevenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const fila = new Array(n + 1);
  for (let j = 0; j <= n; j++) fila[j] = j;
  for (let i = 1; i <= m; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = fila[j];
      fila[j] = a[i - 1] === b[j - 1]
        ? anterior
        : 1 + Math.min(anterior, fila[j], fila[j - 1]);
      anterior = temp;
    }
  }
  return fila[n];
}

// ¿Esta palabra de la búsqueda "calza" con alguna palabra del nombre del
// producto? Primero por substring (rápido, cubre la mayoría de casos);
// si no, por distancia de edición chica — más tolerancia para palabras
// largas (1 error cada ~4 letras, tope 2) que para palabras cortas.
function palabraCoincide(token, palabras) {
  if (palabras.some((p) => p.includes(token) || token.includes(p))) return true;
  const maxDistancia = token.length <= 4 ? 1 : 2;
  return palabras.some((p) => distanciaLevenshtein(token, p) <= maxDistancia);
}

// true si CADA palabra escrita por el usuario coincide con algo del nombre
// (sin importar el orden) o aparece en el código/código de barras.
function coincideProducto(query, nombre, codigo) {
  const tokens = normalizarTexto(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const palabrasNombre = normalizarTexto(nombre).split(' ').filter(Boolean);
  const codigoNorm = normalizarTexto(codigo);
  return tokens.every((t) => codigoNorm.includes(t) || palabraCoincide(t, palabrasNombre));
}

module.exports = { normalizarTexto, distanciaLevenshtein, coincideProducto };
