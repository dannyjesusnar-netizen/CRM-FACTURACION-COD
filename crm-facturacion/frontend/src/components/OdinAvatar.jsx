// Ícono del asistente ODIN: insignia circular con la silueta de una cara
// de bulldog, inspirada en la mascota de la marca del usuario (no es una
// foto ni una imagen generada por IA — es un ícono plano hecho a mano,
// en el mismo espíritu que FloatingShapes/FloatingIcons).
export default function OdinAvatar({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="#161616" />
      <path
        d="M13 17c0-2.2 1.6-4 3.6-4 1.4 0 2.6.8 3.2 2h8.4c.6-1.2 1.8-2 3.2-2 2 0 3.6 1.8 3.6 4 0 1.6-.9 3-2.2 3.6.3.9.4 1.9.4 2.9 0 5.6-4.7 9.5-11.2 9.5S10.8 29.1 10.8 23.5c0-1 .1-2 .4-2.9C9.9 20 9 18.6 9 17c0-.4.1-.8.2-1.1"
        fill="#f5f5f5"
      />
      <ellipse cx="24" cy="24.5" rx="9.4" ry="7.6" fill="#f5f5f5" />
      <circle cx="19.6" cy="23.2" r="1.7" fill="#161616" />
      <circle cx="28.4" cy="23.2" r="1.7" fill="#161616" />
      <path d="M22 27.4c0 1.2.9 2.1 2 2.1s2-.9 2-2.1" stroke="#161616" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="24" cy="26.2" rx="1.6" ry="1.1" fill="#161616" />
    </svg>
  );
}
