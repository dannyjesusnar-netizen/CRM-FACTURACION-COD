import { Link } from 'react-router-dom';

export default function TerminosServicio() {
  return (
    <div className="login-page" style={{ alignItems: 'flex-start', padding: '40px 16px' }}>
      <div className="login-card" style={{ width: 720, maxWidth: '100%' }}>
        <div className="login-brand">
          <span className="brand-mark">QORIA</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <p className="login-subtitle">Términos de Servicio</p>

        <h3>1. El servicio</h3>
        <p>
          El Sistema es un software de gestión comercial y facturación ("SaaS") que cada empresa
          registrada usa para administrar sus ventas, compras, inventario y comprobantes. Al
          registrar una empresa, aceptas estos Términos y nuestra{' '}
          <Link to="/privacidad">Política de Privacidad</Link>.
        </p>

        <h3>2. Cuentas y aprobación</h3>
        <p>
          El registro de una empresa nueva queda pendiente hasta su aprobación. Una vez aprobada,
          la cuenta Gerencia registrada puede crear cuentas adicionales para su equipo desde el
          propio Sistema. Cada empresa es responsable de la confidencialidad de sus contraseñas y
          de las acciones realizadas desde sus cuentas.
        </p>

        <h3>3. Facturación electrónica y obligaciones tributarias</h3>
        <p>
          El Sistema puede operar en <strong>modo simulado</strong> (numeración y comprobantes de
          prueba, sin validez tributaria) o en <strong>modo real</strong>, una vez que la propia
          empresa configure sus credenciales con un Operador de Servicios Electrónicos (OSE)
          autorizado por SUNAT. Cada empresa es responsable de:
        </p>
        <ul>
          <li>Estar correctamente afiliada ante SUNAT como emisor electrónico, si corresponde.</li>
          <li>La exactitud de los datos tributarios que ingresa (RUC, series, tasas de impuesto, etc.).</li>
          <li>El cumplimiento de sus propias obligaciones tributarias y contables.</li>
        </ul>
        <p>
          No somos responsables de sanciones, multas o pérdidas derivadas del incumplimiento de
          obligaciones tributarias de la empresa registrada.
        </p>

        <h3>4. Aislamiento de datos</h3>
        <p>
          Cada empresa registrada tiene su propia base de datos, aislada de las demás empresas
          que usan el Sistema. La empresa es titular de los datos que carga (clientes, productos,
          ventas, empleados) y puede solicitar su exportación o eliminación al finalizar el
          servicio.
        </p>

        <h3>5. Disponibilidad</h3>
        <p>
          El Sistema se ofrece "tal cual" ("as is"), sin garantía de disponibilidad continua
          ininterrumpida. Se realizan esfuerzos razonables para mantenerlo operativo, pero no se
          garantiza un nivel de servicio (SLA) específico salvo acuerdo particular por escrito.
        </p>

        <h3>6. Cancelación</h3>
        <p>
          Cualquiera de las partes puede terminar el uso del Sistema en cualquier momento. Ante
          una solicitud de cancelación, se coordinará la exportación de los datos de la empresa
          antes de su eliminación, salvo obligación legal de conservarlos.
        </p>

        <h3>7. Cambios a estos Términos</h3>
        <p>
          Estos Términos pueden actualizarse; los cambios relevantes se comunicarán a las
          empresas registradas por el medio de contacto que hayan proporcionado.
        </p>

        <h3>8. Contacto</h3>
        <p>
          <a href="mailto:dannyjesusnar@gmail.com">dannyjesusnar@gmail.com</a>
        </p>

        <p className="login-hint">
          <Link to="/registro" className="btn-link">Volver al registro</Link>
        </p>
      </div>
    </div>
  );
}
