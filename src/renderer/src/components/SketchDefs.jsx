// Inline SVG defs mounted once at the app root:
//  • #sketch / #sketch-rough — feTurbulence displacement filters that give
//    bordered surfaces (.card, .sketch) their hand-drawn wobble. The filter
//    only touches the border pseudo-element, so text/shadows stay crisp.
//  • icon sprite (<g id="i-*">) — referenced via <Icon name="…" />.
export default function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="sketch" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.014 0.018" numOctaves="2" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="sketch-rough" x="-6%" y="-6%" width="112%" height="112%">
        <feTurbulence type="fractalNoise" baseFrequency="0.02 0.025" numOctaves="2" seed="13" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
      </filter>

      <defs>
        <g id="i-dashboard">
          <rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" />
          <rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" />
        </g>
        <g id="i-profile">
          <circle cx="12" cy="8" r="4" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
        </g>
        <g id="i-builder">
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r="1.3" className="ic-fill" /><circle cx="4" cy="12" r="1.3" className="ic-fill" /><circle cx="4" cy="18" r="1.3" className="ic-fill" />
        </g>
        <g id="i-run"><path d="M7 5l12 7-12 7z" /></g>
        <g id="i-results">
          <rect x="5" y="4" width="14" height="17" rx="1.6" /><path d="M9 3.5h6v2.5H9z" /><path d="M8.5 12l2 2 4-4.2" />
        </g>
        <g id="i-history"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></g>
        <g id="i-settings">
          <path d="M4 7h9M17 7h3" /><path d="M4 12h3M11 12h9" /><path d="M4 17h12" />
          <circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="12" r="2.2" /><circle cx="18" cy="17" r="2.2" />
        </g>
        <g id="i-health"><path d="M3 12h4l2 5 3-10 2 5h7" /></g>
        <g id="i-pick"><circle cx="12" cy="12" r="5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></g>
        <g id="i-record"><circle cx="12" cy="12" r="6" className="ic-fill" /></g>
        <g id="i-plus"><path d="M12 5v14M5 12h14" /></g>
        <g id="i-chev"><path d="M6 9l6 6 6-6" /></g>
        <g id="i-copy"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 14V5a1 1 0 011-1h9" /></g>
        <g id="i-data"><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v6c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-6" /><path d="M4.5 11.5v6c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8v-6" /></g>
      </defs>
    </svg>
  )
}

// Render a sprite icon: <Icon name="dashboard" size={18} />
export function Icon({ name, size = 18, fill = false, style, ...rest }) {
  return (
    <svg className={`ic${fill ? ' ic-fill' : ''}`} width={size} height={size}
      viewBox="0 0 24 24" style={style} aria-hidden="true" {...rest}>
      <use href={`#i-${name}`} />
    </svg>
  )
}
