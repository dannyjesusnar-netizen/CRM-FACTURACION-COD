// Historial de commits del repositorio, para el log de "modificaciones
// desde el código" del área de Reportes de QORIA Central — se consulta
// directo a la API de GitHub (no hace falta clonar nada acá ni tener git
// instalado en el servidor). Sin GITHUB_TOKEN configurado, responde "no
// disponible" en vez de fallar: es una pieza opcional, el resto de
// Reportes (documentos por sede, auditoría del sistema) funciona igual sin
// esto — para activarla hay que agregar GITHUB_TOKEN (un Personal Access
// Token con permiso de lectura sobre este repo) a las variables de entorno
// del servidor.
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'dannyjesusnar-netizen';
const REPO_NAME = process.env.GITHUB_REPO_NAME || 'CRM-FACTURACION-COD';

async function listarCommitsRecientes({ limit = 30 } = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { disponible: false, mensaje: 'Falta configurar GITHUB_TOKEN en el servidor para ver el historial de commits.' };
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=${Math.min(Number(limit) || 30, 100)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'qoria-panel-central',
        },
      }
    );
    if (!res.ok) {
      return { disponible: false, mensaje: `GitHub respondió ${res.status} — revisa que el token tenga acceso a este repositorio.` };
    }
    const data = await res.json();
    const commits = data.map((c) => ({
      sha: (c.sha || '').slice(0, 7),
      mensaje: (c.commit?.message || '').split('\n')[0],
      autor: c.commit?.author?.name || c.author?.login || 'Desconocido',
      fecha: c.commit?.author?.date || null,
      url: c.html_url,
    }));
    return { disponible: true, commits };
  } catch (err) {
    return { disponible: false, mensaje: 'No se pudo conectar con GitHub: ' + err.message };
  }
}

module.exports = { listarCommitsRecientes };
