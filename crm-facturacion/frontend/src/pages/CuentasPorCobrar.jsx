import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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

  useEffect(() => { load(); }, []);

  function load() {
    api.get('/invoices/deudas').then((res) => setDeudas(res.data));
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
      await api.post(`/invoices/${cobrando.id}/cobros`, { monto: Number(monto), medio, observacion });
      toast.success('Cobro registrado.');
      setCobrando(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el cobro.');
    }
  }

  const totalAdeudado = round2(deudas.reduce((s, d) => s + d.saldo, 0));

  return (
    <div>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-link" title="Volver a Ventas" onClick={() => navigate('/ventas')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        CUENTAS POR COBRAR
      </h1>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: -8 }}>
        Ventas emitidas como "Abonado" con saldo pendiente. Total adeudado: <strong>S/ {totalAdeudado.toFixed(2)}</strong>
      </p>

      <table className="data-table">
        <thead>
          <tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th>Documento</th><th>Total</th><th>Pagado</th><th>Saldo</th><th></th></tr>
        </thead>
        <tbody>
          {deudas.map((d) => (
            <tr key={d.id}>
              <td>{d.fecha_emision}</td>
              <td>{d.serie}-{String(d.numero).padStart(6, '0')}</td>
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
          {deudas.length === 0 && (
            <tr><td colSpan={8} className="empty-row">No hay cuentas por cobrar pendientes.</td></tr>
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
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="banco">Banco</option>
                <option value="otros">Otros</option>
              </select>
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
