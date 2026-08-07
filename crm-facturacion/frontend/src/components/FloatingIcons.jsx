// Iconos de negocio (computadora, calculadora, camión, $, S/, teléfono) que
// flotan suavemente sobre pantallas de la plataforma, con la misma línea
// gráfica de la ilustración del login.
function Icon({ type }) {
  switch (type) {
    case 'computer':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect x="4" y="6" width="32" height="22" rx="4" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
          <rect x="9" y="11" width="12" height="12" rx="2" fill="#a5b4fc" />
          <rect x="23" y="11" width="4" height="12" rx="1" fill="#6366f1" />
          <rect x="29" y="15" width="4" height="8" rx="1" fill="#fbbf24" />
          <rect x="15" y="28" width="10" height="4" fill="#c7c9f4" />
          <rect x="10" y="32" width="20" height="3" rx="1.5" fill="#c7c9f4" />
        </svg>
      );
    case 'calculator':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <rect x="6" y="4" width="28" height="34" rx="5" fill="#334155" />
          <rect x="10" y="9" width="20" height="9" rx="2" fill="#86efac" />
          <rect x="10" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="17.5" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="25" y="22" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="10" y="29" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="17.5" y="29" width="5" height="5" rx="1" fill="#64748b" />
          <rect x="25" y="29" width="5" height="5" rx="1" fill="#fbbf24" />
        </svg>
      );
    case 'truck':
      return (
        <svg viewBox="0 0 40 24" width="100%" height="60%">
          <rect x="2" y="4" width="20" height="14" rx="2" fill="#6366f1" />
          <path d="M22 4h10l6 8v6H22z" fill="#a5b4fc" />
          <rect x="26" y="8" width="6" height="5" rx="1" fill="#eef0fd" />
          <circle cx="10" cy="20" r="4" fill="#334155" />
          <circle cx="30" cy="20" r="4" fill="#334155" />
          <circle cx="10" cy="20" r="1.6" fill="#c7c9f4" />
          <circle cx="30" cy="20" r="1.6" fill="#c7c9f4" />
        </svg>
      );
    case 'dollar':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="18" fill="#22c55e" />
          <text x="20" y="28" textAnchor="middle" fontSize="20" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">$</text>
        </svg>
      );
    case 'soles':
      return (
        <svg viewBox="0 0 40 40" width="100%" height="100%">
          <circle cx="20" cy="20" r="18" fill="#6366f1" />
          <text x="20" y="26" textAnchor="middle" fontSize="15" fontWeight="800" fill="#ffffff" fontFamily="Arial, sans-serif">S/</text>
        </svg>
      );
    case 'phone':
      return (
        <svg viewBox="0 0 26 40" width="100%" height="100%">
          <rect x="2" y="2" width="22" height="36" rx="6" fill="#ffffff" stroke="#c7c9f4" strokeWidth="2" />
          <rect x="6" y="7" width="14" height="22" rx="2" fill="#eef0fd" />
          <circle cx="13" cy="33" r="1.6" fill="#c7c9f4" />
        </svg>
      );
    default:
      return null;
  }
}

export default function FloatingIcons({ icons }) {
  return (
    <>
      {icons.map((ic, i) => (
        <div
          key={i}
          className="sede-float-icon"
          style={{ top: ic.top, left: ic.left, width: ic.size, height: ic.size, animationDelay: ic.delay }}
        >
          <Icon type={ic.type} />
        </div>
      ))}
    </>
  );
}
