import React from 'react';

export default function BibiStoreLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Fondo blanco base para el logo en caso de que use fondo negro */}
      <rect width="200" height="200" fill="#FFFFFF" rx="10" />

      {/* Tira inferior negra */}
      <rect x="15" y="186" width="170" height="6" fill="#000" />
      
      {/* Base de la tienda */}
      <rect x="25" y="80" width="150" height="100" fill="#000" />
      
      {/* Puerta exterior */}
      <rect x="35" y="102" width="46" height="78" fill="#FFF" />
      {/* Puerta interior */}
      <rect x="41" y="108" width="34" height="72" fill="#000" />
      {/* Ventanilla de la puerta */}
      <rect x="41" y="120" width="28" height="5" fill="#FFF" />
      <rect x="58" y="108" width="5" height="12" fill="#FFF" />
      {/* Manija de la puerta */}
      <path d="M 69 146 C 75 146, 75 156, 69 156 Z" fill="#FFF" />
      
      {/* Ventana vitrina exterior */}
      <rect x="92" y="110" width="70" height="50" fill="#FFF" />
      {/* Ventana vitrina interior */}
      <rect x="98" y="116" width="58" height="38" fill="#000" />
      
      {/* Carrito de supermercado dentro de vitrina */}
      <path d="M 104 124 L 110 124 L 115 140 L 140 140 L 145 128 L 112 128" fill="none" stroke="#FFF" strokeWidth="2" strokeLinejoin="round" />
      <line x1="123" y1="128" x2="123" y2="140" stroke="#FFF" strokeWidth="2" />
      <line x1="132" y1="128" x2="132" y2="140" stroke="#FFF" strokeWidth="2" />
      <line x1="113" y1="134" x2="142" y2="134" stroke="#FFF" strokeWidth="2" />
      <circle cx="120" cy="144" r="2.5" fill="#FFF" />
      <circle cx="137" cy="144" r="2.5" fill="#FFF" />
      
      {/* Techo pequeño superior */}
      <rect x="35" y="24" width="130" height="8" fill="#000" />
      
      {/* Toldo principal (borde grueso blanco para separar del resto) */}
      <path d="M 35 36 
               L 165 36 
               L 185 80 
               A 21.25 21.25 0 0 1 142.5 80 
               A 21.25 21.25 0 0 1 100 80 
               A 21.25 21.25 0 0 1 57.5 80 
               A 21.25 21.25 0 0 1 15 80 
               Z" 
            fill="#000" stroke="#FFF" strokeWidth="6" strokeLinejoin="round" />
            
      {/* Toldo principal (relleno, tapa parte del borde interno) */}
      <path d="M 35 36 
               L 165 36 
               L 185 80 
               A 21.25 21.25 0 0 1 142.5 80 
               A 21.25 21.25 0 0 1 100 80 
               A 21.25 21.25 0 0 1 57.5 80 
               A 21.25 21.25 0 0 1 15 80 
               Z" 
            fill="#000" />
            
      {/* Texto del toldo */}
      <text x="100" y="68" fontFamily="'Arial Rounded MT Bold', 'Nunito', 'Segoe UI', 'Roboto', sans-serif" fontWeight="900" fontSize="30" fill="#FFD700" stroke="#FF0000" strokeWidth="1.5" textAnchor="middle" letterSpacing="0.5">Bibi Store</text>
    </svg>
  );
}
