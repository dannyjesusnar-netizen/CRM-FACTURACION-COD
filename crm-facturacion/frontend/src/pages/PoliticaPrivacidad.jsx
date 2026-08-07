import { Link } from 'react-router-dom';

export default function PoliticaPrivacidad() {
  return (
    <div className="login-page" style={{ alignItems: 'flex-start', padding: '40px 16px' }}>
      <div className="login-card" style={{ width: 720, maxWidth: '100%' }}>
        <div className="login-brand">
          <span className="brand-mark">CRM</span>
          <span className="brand-suffix">Facturación</span>
        </div>
        <p className="login-subtitle">Política de Privacidad</p>

        <p>
          Esta política aplica al software de facturación y gestión comercial ("el Sistema"),
          conforme a la Ley N° 29733 (Ley de Protección de Datos Personales del Perú) y su
          reglamento.
        </p>

        <h3>1. Qué datos recolectamos</h3>
        <p>
          Al registrar una empresa: RUC, razón social, nombre comercial, dirección, teléfono y
          correo de la empresa; y del usuario Gerencia registrado: nombres, apellidos, DNI y
          contraseña (guardada siempre cifrada, nunca en texto plano). Una vez en uso, la empresa
          puede cargar además datos de sus propios clientes y empleados (nombres, documentos de
          identidad, teléfonos, correos, direcciones) para emitir comprobantes y administrar su
          negocio.
        </p>

        <h3>2. Para qué los usamos</h3>
        <p>
          Exclusivamente para operar el Sistema: autenticación, emisión de comprobantes,
          reportes, y comunicarnos con la empresa registrada sobre el estado de su cuenta (por
          ejemplo, la aprobación de su registro). No vendemos ni compartimos estos datos con
          terceros para fines publicitarios.
        </p>

        <h3>3. Quién es responsable de qué</h3>
        <p>
          Cada empresa registrada es la <strong>Titular</strong> de los datos de sus propios
          clientes y empleados que carga al Sistema — decide qué guarda y para qué. Nosotros
          actuamos como <strong>Encargados de tratamiento</strong>: alojamos y procesamos esos
          datos por cuenta de la empresa, con las medidas de seguridad descritas abajo.
        </p>

        <h3>4. Aislamiento y seguridad</h3>
        <p>
          Cada empresa registrada tiene su propia base de datos, completamente separada de las
          demás — ninguna empresa puede ver datos de otra. Las contraseñas se guardan cifradas
          (nunca en texto plano), las sesiones usan tokens con expiración, y las conexiones viajan
          cifradas (HTTPS).
        </p>

        <h3>5. Retención y eliminación</h3>
        <p>
          Los datos se conservan mientras la cuenta esté activa. Si una empresa deja de usar el
          Sistema y solicita la eliminación de sus datos, se atenderá el pedido salvo que exista
          una obligación legal de conservarlos (por ejemplo, plazos tributarios sobre
          comprobantes ya emitidos).
        </p>

        <h3>6. Tus derechos (ARCO)</h3>
        <p>
          Cualquier persona cuyos datos estén en el Sistema puede solicitar Acceso,
          Rectificación, Cancelación u Oposición sobre ellos, escribiendo a{' '}
          <a href="mailto:dannyjesusnar@gmail.com">dannyjesusnar@gmail.com</a>. Si el dato
          corresponde a un cliente o empleado de una empresa registrada, la solicitud se
          canalizará primero a esa empresa, que es su Titular.
        </p>

        <h3>7. Verificación de RUC</h3>
        <p>
          Al registrarse, el RUC ingresado puede verificarse contra fuentes públicas de SUNAT a
          través de un proveedor externo, únicamente para confirmar que corresponde a una empresa
          real y activa — no se comparte ningún otro dato con ese proveedor.
        </p>

        <h3>8. Contacto</h3>
        <p>
          Consultas sobre esta política: <a href="mailto:dannyjesusnar@gmail.com">dannyjesusnar@gmail.com</a>.
        </p>

        <p className="login-hint">
          <Link to="/registro" className="btn-link">Volver al registro</Link>
        </p>
      </div>
    </div>
  );
}
