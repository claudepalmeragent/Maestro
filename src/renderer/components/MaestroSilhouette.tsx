import React from 'react';

interface MaestroSilhouetteProps {
  className?: string;
  style?: React.CSSProperties;
  variant?: 'dark' | 'light'; // dark = black silhouette, light = white silhouette
  size?: number;
}

/**
 * Maestro conductor silhouette SVG component
 * Based on classic conductor clip art - shows a conductor in profile with raised baton
 */
export function MaestroSilhouette({
  className = '',
  style = {},
  variant = 'dark',
  size = 200,
}: MaestroSilhouetteProps) {
  const fillColor = variant === 'dark' ? '#000000' : '#FFFFFF';

  return (
    <svg
      viewBox="0 0 400 450"
      width={size}
      height={size * 1.125}
      className={className}
      style={style}
      aria-label="Maestro conductor silhouette"
    >
      {/* Head - profile facing left */}
      <ellipse cx="180" cy="80" rx="55" ry="60" fill={fillColor} />
      {/* Nose bump */}
      <ellipse cx="118" cy="85" rx="12" ry="8" fill={fillColor} />
      {/* Hair/top of head */}
      <ellipse cx="185" cy="35" rx="40" ry="25" fill={fillColor} />

      {/* Neck */}
      <rect x="155" y="130" width="50" height="40" fill={fillColor} />

      {/* Collar/bow tie area */}
      <polygon points="140,165 260,165 250,185 150,185" fill={fillColor} />
      {/* Bow tie */}
      <ellipse cx="200" cy="175" rx="25" ry="10" fill={fillColor} />

      {/* Torso - jacket */}
      <path
        d="M 140 185
           L 120 350
           L 280 350
           L 260 185
           Z"
        fill={fillColor}
      />

      {/* Left arm (bent, holding something) */}
      <path
        d="M 140 200
           Q 90 220, 80 280
           Q 75 300, 90 310
           L 110 305
           Q 120 290, 115 260
           Q 130 240, 145 230
           Z"
        fill={fillColor}
      />

      {/* Left hand */}
      <ellipse cx="85" cy="295" rx="18" ry="22" fill={fillColor} />

      {/* Right arm - raised with baton */}
      <path
        d="M 260 200
           Q 300 180, 330 130
           Q 340 115, 355 100
           L 365 110
           Q 350 130, 340 145
           Q 315 195, 270 220
           Z"
        fill={fillColor}
      />

      {/* Right hand */}
      <ellipse cx="350" cy="95" rx="15" ry="18" fill={fillColor} />

      {/* Baton */}
      <line
        x1="360"
        y1="85"
        x2="395"
        y2="20"
        stroke={fillColor}
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* Cuff details - white stripe on sleeves */}
      <rect
        x="78"
        y="275"
        width="20"
        height="8"
        fill={variant === 'dark' ? '#FFFFFF' : '#000000'}
        rx="2"
      />
      <rect
        x="335"
        y="88"
        width="18"
        height="8"
        fill={variant === 'dark' ? '#FFFFFF' : '#000000'}
        rx="2"
        transform="rotate(-30, 344, 92)"
      />
    </svg>
  );
}

/**
 * Animated maestro for the Standing Ovation overlay
 * Includes a subtle conducting motion animation
 */
export function AnimatedMaestro({
  className = '',
  style = {},
  variant = 'dark',
  size = 200,
}: MaestroSilhouetteProps) {
  const fillColor = variant === 'dark' ? '#000000' : '#FFFFFF';
  const cuffColor = variant === 'dark' ? '#FFFFFF' : '#000000';

  return (
    <svg
      viewBox="0 0 400 450"
      width={size}
      height={size * 1.125}
      className={className}
      style={style}
      aria-label="Animated maestro conductor"
    >
      <defs>
        {/* Glow filter for dramatic effect */}
        <filter id="maestro-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        {/* Conducting animation for the baton arm */}
        <animateTransform
          xlinkHref="#baton-arm"
          attributeName="transform"
          type="rotate"
          values="0 260 200; -8 260 200; 0 260 200; 5 260 200; 0 260 200"
          dur="2s"
          repeatCount="indefinite"
        />
      </defs>

      <g filter="url(#maestro-glow)">
        {/* Head - profile facing left */}
        <ellipse cx="180" cy="80" rx="55" ry="60" fill={fillColor} />
        {/* Nose bump */}
        <ellipse cx="118" cy="85" rx="12" ry="8" fill={fillColor} />
        {/* Hair/top of head */}
        <ellipse cx="185" cy="35" rx="40" ry="25" fill={fillColor} />

        {/* Neck */}
        <rect x="155" y="130" width="50" height="40" fill={fillColor} />

        {/* Collar/bow tie area */}
        <polygon points="140,165 260,165 250,185 150,185" fill={fillColor} />
        {/* Bow tie */}
        <ellipse cx="200" cy="175" rx="25" ry="10" fill={fillColor} />

        {/* Torso - jacket */}
        <path
          d="M 140 185
             L 120 350
             L 280 350
             L 260 185
             Z"
          fill={fillColor}
        />

        {/* Left arm (bent, holding something) */}
        <path
          d="M 140 200
             Q 90 220, 80 280
             Q 75 300, 90 310
             L 110 305
             Q 120 290, 115 260
             Q 130 240, 145 230
             Z"
          fill={fillColor}
        />

        {/* Left hand */}
        <ellipse cx="85" cy="295" rx="18" ry="22" fill={fillColor} />

        {/* Right arm group - animated */}
        <g id="baton-arm">
          {/* Right arm - raised with baton */}
          <path
            d="M 260 200
               Q 300 180, 330 130
               Q 340 115, 355 100
               L 365 110
               Q 350 130, 340 145
               Q 315 195, 270 220
               Z"
            fill={fillColor}
          />

          {/* Right hand */}
          <ellipse cx="350" cy="95" rx="15" ry="18" fill={fillColor} />

          {/* Baton */}
          <line
            x1="360"
            y1="85"
            x2="395"
            y2="20"
            stroke={fillColor}
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* Right cuff */}
          <rect
            x="335"
            y="88"
            width="18"
            height="8"
            fill={cuffColor}
            rx="2"
            transform="rotate(-30, 344, 92)"
          />
        </g>

        {/* Left cuff */}
        <rect x="78" y="275" width="20" height="8" fill={cuffColor} rx="2" />
      </g>
    </svg>
  );
}

export default MaestroSilhouette;
