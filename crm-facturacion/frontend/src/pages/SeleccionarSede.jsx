import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2 } from 'lucide-react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import FloatingShapes from '../components/FloatingShapes';
import FloatingIcons from '../components/FloatingIcons';

const ROLE_LABEL = { gerencia: 'Administrador', vendedor: 'Vendedor' };

const SEDE_SHAPES = [
  { type: 'dot', top: '8%', left: '12%', size: 14, color: '#fbbf24', delay: '0s' },
  { type: 'plus', top: '15%', left: '85%', size: 16, color: '#6366f1', delay: '0.5s' },
  { type: 'square', top: '28%', left: '6%', size: 14, color: '#f472b6', delay: '0.9s' },
  { type: 'dot', top: '18%', left: '48%', size: 8, color: '#6366f1', delay: '0.3s' },
  { type: 'plus', top: '42%', left: '93%', size: 14, color: '#22c55e', delay: '1.1s' },
  { type: 'square', top: '62%', left: '4%', size: 12, color: '#6366f1', delay: '0.4s' },
  { type: 'dot', top: '70%', left: '91%', size: 10, color: '#fbbf24', delay: '0.7s' },
  { type: 'plus', top: '84%', left: '18%', size: 16, color: '#f472b6', delay: '0.2s' },
  { type: 'dot', top: '90%', left: '56%', size: 9, color: '#22c55e', delay: '1s' },
  { type: 'dot', top: '6%', left: '70%', size: 10, color: '#f472b6', delay: '0.6s' },
  { type: 'plus', top: '93%', left: '82%', size: 14, color: '#6366f1', delay: '0.85s' },
];

const SEDE_ICONS = [
  { type: 'computer', top: '9%', left: '28%', size: 38, delay: '0.15s' },
  { type: 'calculator', top: '11%', left: '66%', size: 34, delay: '0.55s' },
  { type: 'truck', top: '52%', left: '6%', size: 42, delay: '0.75s' },
  { type: 'dollar', top: '80%', left: '30%', size: 34, delay: '0.35s' },
  { type: 'soles', top: '32%', left: '90%', size: 34, delay: '1s' },
  { type: 'phone', top: '78%', left: '80%', size: 30, delay: '0.05s' },
];

// Alto de cada fila y cuántas se ven a la vez dentro de la rueda — ambos
// números deben coincidir con el CSS (.sede-wheel-item, .sede-wheel-viewport).
const ITEM_HEIGHT = 64;
const VISIBLE_ITEMS = 5;
const VIEWPORT_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PAD = (VIEWPORT_HEIGHT - ITEM_HEIGHT) / 2;

export default function SeleccionarSede() {
  const { user, setSucursal } = useAuth();
  const navigate = useNavigate();
  const [sucursales, setSucursales] = useState(null);
  const [centrado, setCentrado] = useState(0);
  const viewportRef = useRef(null);
  const itemRefs = useRef([]);
  const rafRef = useRef(null);

  useEffect(() => {
    api.get('/sucursales').then((res) => {
      // Si solo hay una sede activa, no tiene sentido pedir que la elijan.
      if (res.data.length <= 1) {
        const unica = res.data[0];
        if (unica) {
          setSucursal(unica.id, unica.nombre);
          navigate('/menu', { replace: true });
          return;
        }
      }
      setSucursales(res.data);
    });
  }, []);

  function elegir(s) {
    setSucursal(s.id, s.nombre);
    navigate('/menu');
  }

  // Al hacer scroll (rueda del mouse o arrastre táctil) recalculamos, sin
  // esperar al render de React, qué tan cerca está cada fila del centro de
  // la ventana visible — así la que queda enfrente se agranda y resalta,
  // como una rueda de selección (igual que un picker de fecha en celular).
  function handleScroll() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = viewportRef.current;
      if (!el) return;
      const centroViewport = el.scrollTop + el.clientHeight / 2;
      let idxMasCercano = 0;
      let distMinima = Infinity;
      itemRefs.current.forEach((nodo, i) => {
        if (!nodo) return;
        const centroItem = nodo.offsetTop + nodo.offsetHeight / 2;
        const dist = Math.abs(centroItem - centroViewport);
        const normalizada = Math.min(dist / (ITEM_HEIGHT * 1.6), 1);
        nodo.style.transform = `scale(${1 - normalizada * 0.24})`;
        nodo.style.opacity = String(1 - normalizada * 0.7);
        if (dist < distMinima) { distMinima = dist; idxMasCercano = i; }
      });
      setCentrado((prev) => (prev !== idxMasCercano ? idxMasCercano : prev));
    });
  }

  useEffect(() => {
    handleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursales]);

  function moverA(delta) {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollBy({ top: delta * ITEM_HEIGHT, behavior: 'smooth' });
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverA(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moverA(-1); }
    else if (e.key === 'Enter' && sucursales?.[centrado]) { elegir(sucursales[centrado]); }
  }

  if (!sucursales) return null;

  return (
    <div className="sede-page">
      <FloatingShapes shapes={SEDE_SHAPES} />
      <FloatingIcons icons={SEDE_ICONS} />
      <div className="login-card" style={{ maxWidth: 420 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Selecciona un negocio</h2>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-muted)', marginTop: 0, marginBottom: 16 }}>
          Desplázate para ver las sedes — haz clic en la que quieras entrar.
        </p>

        <div className="sede-wheel" style={{ height: VIEWPORT_HEIGHT }}>
          <div className="sede-wheel-highlight" style={{ height: ITEM_HEIGHT }} />
          <div
            className="sede-wheel-viewport"
            style={{ height: VIEWPORT_HEIGHT }}
            ref={viewportRef}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            <div style={{ height: PAD }} />
            {sucursales.map((s, i) => (
              <div
                key={s.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                className={'sede-wheel-item' + (i === centrado ? ' active' : '')}
                style={{ height: ITEM_HEIGHT }}
                onClick={() => elegir(s)}
                role="button"
                tabIndex={-1}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Building2 size={18} style={{ opacity: 0.6 }} />
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 600 }}>
                      {ROLE_LABEL[user?.role] || user?.role}
                    </div>
                    <div style={{ fontWeight: 700 }}>{s.nombre}</div>
                  </div>
                </div>
                <ArrowRight size={18} style={{ opacity: 0.5 }} />
              </div>
            ))}
            <div style={{ height: PAD }} />
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          style={{ width: '100%', marginTop: 16 }}
          onClick={() => sucursales[centrado] && elegir(sucursales[centrado])}
        >
          Entrar a {sucursales[centrado]?.nombre}
        </button>
      </div>
    </div>
  );
}
