import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import MetodoPagoQr from '../components/MetodoPagoQr';
import ExportButton from '../components/ExportButton';
import { exportarTabla } from '../utils/excelImport';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function tipoLabel(d) {
  if (d._source === 'nota_venta') return 'Nota de Venta Interna';
  if (d.tipo_comprobante === 'factura') return 'Factura';
  return 'Boleta';
}

export default function CuentasPorCobrar() {
  const navigate = useNavigate();
  const toast = useToast();
  const [deudas, setDeudas] = useState([]);
  const [cobrando, setCobrando] = useState(null); // deuda seleccionada para registrar cobro
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState('efectivo');
  const [observacion, setObservacion] = useState('');
  const [error, setError] = useState('');
  const [metodosPago, setMetodosPago] = useState([]);
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [vista, setVista] = useState('detalle'); // 'detalle' | 'resumen'
  const [expandido, setExpandido] = useState(null); // client_id expandido en la vista Resumen

  const [marcando, setMarcando] = useState(null); // grupo de cliente para "Marcar todo pagado"
  const [medioMarcar, setMedioMarcar] = useState('efectivo');
  const [observacionMarcar, setObservacionMarcar] = useState('');
  const [errorMarcar, setErrorMarcar] = useState('');

  useEffect(() => {
    load();
    api.get('/metodos-pago').then((res) => setMetodosPago(res.data));
  }, []);

  function load() {
    Promise.all([
      api.get('/invoices/deudas'),
      api.get('/notas-venta/deudas'),
    ]).then(([invRes, nvRes]) => {
      const invRows = invRes.data.map((r) => ({ ...r, _source: 'invoice' }));
      const nvRows = nvRes.data.map((r) => ({ ...r, _source: 'nota_venta' }));
      const merged = [...invRows, ...nvRows].sort((a, b) => (a.fecha_emision < b.fecha_emision ? -1 : 1));
      setDeudas(merged);
    });
  }

  function openCobro(d) {
    setCobrando(d);
    setMonto(d.saldo.toFixed(2));
    setMedio('efectivo');
    setError('');
  }

  async function handleSubmitCobro(e) {
    e.preventDefault();
    setError('');
    try {
      const base = cobrando._source === 'nota_venta' ? '/notas-venta' : '/invoices';
      await api.post(`${base}/${cobrando.id}/cobros`, { monto: Number(monto), medio, observacion });
      toast.success('Cobro registrado.');
      setCobrando(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el cobro.');
    }
  }

  // Filtro por persona que debe: nombre o número de documento del cliente.
  const qNorm = q.trim().toLowerCase();
  const deudasFiltradas = deudas.filter((d) => {
    if (qNorm) {
      const coincide = (d.cliente_nombre || '').toLowerCase().includes(qNorm) ||
        (d.cliente_documento || '').toLowerCase().includes(qNorm);
      if (!coincide) return false;
    }
    if (desde && d.fecha_emision < desde) return false;
    if (hasta && d.fecha_emision > hasta) return false;
    return true;
  });

  // Nunca sumar soles y dólares como si fueran la misma unidad.
  const totalAdeudadoPEN = round2(deudasFiltradas.filter((d) => d.moneda !== 'USD').reduce((s, d) => s + d.saldo, 0));
  const totalAdeudadoUSD = round2(deudasFiltradas.filter((d) => d.moneda === 'USD').reduce((s, d) => s + d.saldo, 0));

  // Vista Resumen: cuánto debe cada cliente en total, agrupando sus
  // comprobantes pendientes (puede tener varias facturas/notas a la vez).
  const resumenPorCliente = [];
  const indicePorCliente = new Map();
  for (const d of deudasFiltradas) {
    const key = d.client_id;
    let g = indicePorCliente.get(key);
    if (!g) {
      g = {
        client_id: key, cliente_nombre: d.cliente_nombre, cliente_documento: d.cliente_documento,
        cliente_tipo_documento: d.cliente_tipo_documento, items: [], totalPEN: 0, totalUSD: 0,
      };
      indicePorCliente.set(key, g);
      resumenPorCliente.push(g);
    }
    g.items.push(d);
    if (d.moneda === 'USD') g.totalUSD = round2(g.totalUSD + d.saldo);
    else g.totalPEN = round2(g.totalPEN + d.saldo);
  }
  resumenPorCliente.sort((a, b) => (b.totalPEN + b.totalUSD) - (a.totalPEN + a.totalUSD));

  function abrirMarcarTodo(grupo) {
    setMarcando(grupo);
    setMedioMarcar('efectivo');
    setObservacionMarcar('');
    setErrorMarcar('');
  }

  async function handleMarcarTodoPagado(e) {
    e.preventDefault();
    setErrorMarcar('');
    try {
      for (const d of marcando.items) {
        const base = d._source === 'nota_venta' ? '/notas-venta' : '/invoices';
        await api.post(`${base}/${d.id}/cobros`, { monto: d.saldo, medio: medioMarcar, observacion: observacionMarcar || 'Pago de fin de mes' });
      }
      toast.success(`Se marcó como pagado ${marcando.items.length} comprobante(s) de ${marcando.cliente_nombre}.`);
      setMarcando(null);
      load();
    } catch (err) {
      setErrorMarcar(err.response?.data?.error || 'No se pudo completar el pago de todos los comprobantes.');
    }
  }

  async function handleExportar(formato) {
    const header = ['Fecha', 'Comprobante', 'Tipo', 'Cliente', 'Documento', 'Vendedor', 'Total', 'Pagado', 'Saldo'];
    const rows = deudasFiltradas.map((d) => [
      d.fecha_emision,
      `${d.serie}-${String(d.numero).padStart(6, '0')}`,
      tipoLabel(d),
      d.cliente_nombre,
      `${d.cliente_tipo_documento || ''} ${d.cliente_documento || ''}`.trim(),
      d.vendedor_nombre || '',
      d.total,
      d.monto_pagado,
      d.saldo,
    ]);
    await exportarTabla('cuentas_por_cobrar', header, rows, formato);
    toast.success(`Archivo ${formato === 'excel' ? 'Excel' : 'CSV'} exportado.`);
  }

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Caja y Bancos" onClick={() => navigate('/caja')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CUENTAS POR COBRAR
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Ventas y notas de venta interna emitidas como "Abonado" (crédito) con saldo pendiente. Total adeudado: <strong>S/ {totalAdeudadoPEN.toFixed(2)}</strong>
        {totalAdeudadoUSD > 0 && <> + <strong>$ {totalAdeudadoUSD.toFixed(2)}</strong></>}
      </p>

      <div className="filter-panel" style={{ marginBottom: 12 }}>
        <div className="filter-field grow">
          <label>Buscar por nombre o número doc.</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nro. doc/nombre.." />
        </div>
        <div className="filter-field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="filter-field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <ExportButton onExport={handleExportar} className="btn-primary" />
      </div>

      <div className="view-tabs">
        <button type="button" className={'view-tab-btn' + (vista === 'detalle' ? ' active' : '')} onClick={() => setVista('detalle')}>
          Detalle
        </button>
        <button type="button" className={'view-tab-btn' + (vista === 'resumen' ? ' active' : '')} onClick={() => setVista('resumen')}>
          Resumen por cliente
        </button>
      </div>

      {vista === 'detalle' && (
        <table className="data-table">
          <thead>
            <tr><th>Fecha</th><th>Comprobante</th><th>Tipo</th><th>Cliente</th><th>Documento</th><th>Vendedor</th><th>Total</th><th>Pagado</th><th>Saldo</th><th></th></tr>
          </thead>
          <tbody>
            {deudasFiltradas.map((d) => (
              <tr key={`${d._source}-${d.id}`}>
                <td>{d.fecha_emision}</td>
                <td>{d.serie}-{String(d.numero).padStart(6, '0')}</td>
                <td>{tipoLabel(d)}</td>
                <td>{d.cliente_nombre}</td>
                <td>{d.cliente_tipo_documento} {d.cliente_documento}</td>
                <td>{d.vendedor_nombre || '—'}</td>
                <td>S/ {d.total.toFixed(2)}</td>
                <td>S/ {d.monto_pagado.toFixed(2)}</td>
                <td><strong>S/ {d.saldo.toFixed(2)}</strong></td>
                <td className="row-actions">
                  <button className="btn-link" onClick={() => openCobro(d)}>Registrar cobro</button>
                </td>
              </tr>
            ))}
            {deudasFiltradas.length === 0 && (
              <tr><td colSpan={10} className="empty-row">
                {deudas.length === 0 ? 'No hay cuentas por cobrar pendientes.' : 'Ningún comprobante coincide con el filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      )}

      {vista === 'resumen' && (
        <table className="data-table">
          <thead>
            <tr><th>Cliente</th><th>Documento</th><th style={{ textAlign: 'right' }}>Comprobantes</th><th style={{ textAlign: 'right' }}>Total adeudado</th><th></th></tr>
          </thead>
          <tbody>
            {resumenPorCliente.map((g) => (
              <Fragment key={g.client_id}>
                <tr>
                  <td>{g.cliente_nombre}</td>
                  <td>{g.cliente_tipo_documento} {g.cliente_documento}</td>
                  <td style={{ textAlign: 'right' }}>{g.items.length}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>S/ {g.totalPEN.toFixed(2)}</strong>
                    {g.totalUSD > 0 && <> + <strong>$ {g.totalUSD.toFixed(2)}</strong></>}
                  </td>
                  <td className="row-actions">
                    <button className="btn-link" onClick={() => setExpandido(expandido === g.client_id ? null : g.client_id)}>
                      {expandido === g.client_id ? 'Ocultar' : 'Ver detalle'}
                    </button>
                    <button className="btn-link" onClick={() => abrirMarcarTodo(g)}>Marcar todo pagado</button>
                  </td>
                </tr>
                {expandido === g.client_id && g.items.map((d) => (
                  <tr key={`${d._source}-${d.id}`} className="caja-row-auto">
                    <td colSpan={2} style={{ paddingLeft: 28 }}>{d.fecha_emision} · {d.serie}-{String(d.numero).padStart(6, '0')} · {tipoLabel(d)}</td>
                    <td></td>
                    <td style={{ textAlign: 'right' }}>S/ {d.saldo.toFixed(2)}</td>
                    <td className="row-actions">
                      <button className="btn-link" onClick={() => openCobro(d)}>Registrar cobro</button>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {resumenPorCliente.length === 0 && (
              <tr><td colSpan={5} className="empty-row">
                {deudas.length === 0 ? 'No hay cuentas por cobrar pendientes.' : 'Ningún cliente coincide con el filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      )}

      {cobrando && (
        <div className="modal-overlay" onClick={() => setCobrando(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar cobro — {cobrando.cliente_nombre}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Comprobante {cobrando.serie}-{String(cobrando.numero).padStart(6, '0')} · Saldo pendiente: S/ {cobrando.saldo.toFixed(2)}
            </p>
            <form onSubmit={handleSubmitCobro}>
              <label>Monto a cobrar</label>
              <input required type="number" min="0.01" step="0.01" max={cobrando.saldo} value={monto} onChange={(e) => setMonto(e.target.value)} />
              <label>Medio</label>
              <select value={medio} onChange={(e) => setMedio(e.target.value)}>
                {metodosPago.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                ))}
              </select>
              <div style={{ marginTop: -8, marginBottom: 12 }}>
                <MetodoPagoQr metodo={metodosPago.find((m) => m.codigo === medio)} monto={Number(monto || 0)} />
              </div>
              <label>Observación (opcional)</label>
              <input value={observacion} onChange={(e) => setObservacion(e.target.value)} />
              {error && <div className="form-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setCobrando(null)}>Cancelar</button>
                <button type="submit" className="btn-primary">Registrar cobro</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {marcando && (
        <div className="modal-overlay" onClick={() => setMarcando(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Marcar todo pagado — {marcando.cliente_nombre}</h2>
            <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              {marcando.items.length} comprobante{marcando.items.length !== 1 ? 's' : ''} pendiente{marcando.items.length !== 1 ? 's' : ''} · Total: S/ {marcando.totalPEN.toFixed(2)}
              {marcando.totalUSD > 0 && <> + $ {marcando.totalUSD.toFixed(2)}</>}
            </p>
            <form onSubmit={handleMarcarTodoPagado}>
              <label>Medio de pago</label>
              <select value={medioMarcar} onChange={(e) => setMedioMarcar(e.target.value)}>
                {metodosPago.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.icono} {m.nombre}</option>
                ))}
              </select>
              <label>Observación (opcional)</label>
              <input value={observacionMarcar} onChange={(e) => setObservacionMarcar(e.target.value)} placeholder="Ej: Pago de fin de mes" />
              {errorMarcar && <div className="form-error">{errorMarcar}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setMarcando(null)}>Cancelar</button>
                <button type="submit" className="btn-primary">
                  Marcar {marcando.items.length} como pagado{marcando.items.length !== 1 ? 's' : ''}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
