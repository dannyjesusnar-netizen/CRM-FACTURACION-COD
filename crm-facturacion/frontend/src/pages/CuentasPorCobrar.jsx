import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import MetodoPagoQr from '../components/MetodoPagoQr';

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
  const deudasFiltradas = qNorm
    ? deudas.filter((d) =>
        (d.cliente_nombre || '').toLowerCase().includes(qNorm) ||
        (d.cliente_documento || '').toLowerCase().includes(qNorm))
    : deudas;

  // Nunca sumar soles y dólares como si fueran la misma unidad.
  const totalAdeudadoPEN = round2(deudasFiltradas.filter((d) => d.moneda !== 'USD').reduce((s, d) => s + d.saldo, 0));
  const totalAdeudadoUSD = round2(deudasFiltradas.filter((d) => d.moneda === 'USD').reduce((s, d) => s + d.saldo, 0));

  function handleExportar() {
    const header = ['Fecha', 'Comprobante', 'Tipo', 'Cliente', 'Documento', 'Total', 'Pagado', 'Saldo'];
    const rows = deudasFiltradas.map((d) => [
      d.fecha_emision,
      `${d.serie}-${String(d.numero).padStart(6, '0')}`,
      tipoLabel(d),
      d.cliente_nombre,
      `${d.cliente_tipo_documento || ''} ${d.cliente_documento || ''}`.trim(),
      d.total,
      d.monto_pagado,
      d.saldo,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cuentas_por_cobrar.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('Archivo CSV exportado.');
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
        <button type="button" className="btn-primary" onClick={handleExportar}>Exportar</button>
      </div>

      <table className="data-table">
        <thead>
          <tr><th>Fecha</th><th>Comprobante</th><th>Tipo</th><th>Cliente</th><th>Documento</th><th>Total</th><th>Pagado</th><th>Saldo</th><th></th></tr>
        </thead>
        <tbody>
          {deudasFiltradas.map((d) => (
            <tr key={`${d._source}-${d.id}`}>
              <td>{d.fecha_emision}</td>
              <td>{d.serie}-{String(d.numero).padStart(6, '0')}</td>
              <td>{tipoLabel(d)}</td>
              <td>{d.cliente_nombre}</td>
              <td>{d.cliente_tipo_documento} {d.cliente_documento}</td>
              <td>S/ {d.total.toFixed(2)}</td>
              <td>S/ {d.monto_pagado.toFixed(2)}</td>
              <td><strong>S/ {d.saldo.toFixed(2)}</strong></td>
              <td className="row-actions">
                <button className="btn-link" onClick={() => openCobro(d)}>Registrar cobro</button>
              </td>
            </tr>
          ))}
          {deudasFiltradas.length === 0 && (
            <tr><td colSpan={9} className="empty-row">
              {deudas.length === 0 ? 'No hay cuentas por cobrar pendientes.' : 'Ningún cliente coincide con la búsqueda.'}
            </td></tr>
          )}
        </tbody>
      </table>

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
    </div>
  );
}
