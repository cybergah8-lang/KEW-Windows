// Kew — intro splash. A walking keklik that wags its tail. Cybergah Group.

export function Intro({ tagline, onSkip }: { tagline: string; onSkip: () => void }) {
  return (
    <div className="intro" onClick={onSkip}>
      <div className="intro-stage">
        <svg className="kew-walk" viewBox="0 0 240 220" xmlns="http://www.w3.org/2000/svg" aria-label="Kew">
          {/* ground + moving shadow */}
          <ellipse className="kew-shadow" cx="118" cy="202" rx="66" ry="9" />

          <g className="kew-bird">
            {/* tail (wags) */}
            <g className="kew-tail">
              <polygon points="72,112 6,84 28,112 72,152" fill="#96804f" />
            </g>

            {/* legs (step) */}
            <g className="kew-leg l">
              <line x1="108" y1="158" x2="100" y2="196" stroke="#D4322A" strokeWidth="7" strokeLinecap="round" />
              <path d="M100,196 l-11,3 M100,196 l11,3" stroke="#D4322A" strokeWidth="5" strokeLinecap="round" />
            </g>
            <g className="kew-leg r">
              <line x1="134" y1="160" x2="142" y2="198" stroke="#D4322A" strokeWidth="7" strokeLinecap="round" />
              <path d="M142,198 l-11,3 M142,198 l11,3" stroke="#D4322A" strokeWidth="5" strokeLinecap="round" />
            </g>

            {/* body */}
            <ellipse cx="114" cy="120" rx="62" ry="50" fill="#C9B27A" />
            <ellipse cx="120" cy="134" rx="42" ry="34" fill="#DCD0A8" />
            {/* flank bars */}
            <g stroke="#96804f" strokeWidth="4" strokeLinecap="round" opacity="0.8">
              <line x1="92" y1="120" x2="120" y2="123" />
              <line x1="90" y1="133" x2="118" y2="136" />
            </g>

            {/* head */}
            <circle cx="170" cy="86" r="34" fill="#C9B27A" />
            <ellipse cx="178" cy="92" rx="26" ry="24" fill="#F5EDD6" />
            {/* chukar face-stripe */}
            <path d="M150,62 Q190,62 198,104" stroke="#16140F" strokeWidth="7" fill="none" strokeLinecap="round" />
            {/* eye (blinks) */}
            <circle className="kew-eye" cx="176" cy="83" r="6.5" fill="#16140F" />
            <circle cx="178.6" cy="80.6" r="2.1" fill="#F5EDD6" />
            {/* beak */}
            <polygon points="196,82 234,74 203,104" fill="#D4322A" />
          </g>
        </svg>
      </div>

      <div className="intro-word">KEW</div>
      <div className="intro-tag">{tagline}</div>
      <div className="intro-by">Cybergah Group · cybergah.com</div>
    </div>
  );
}
