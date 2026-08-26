'use client'

// Self-drawing price-line loader: a zigzag chart line traces itself
// left-to-right, the arrowhead at the final tick draws on right after,
// then it loops. Pure stroke motion — nothing blinks.

export function ChartLoader() {
  return (
    <svg
      width="96"
      height="52"
      viewBox="0 0 64 36"
      fill="none"
      stroke="#00FF9C"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <style>{`
        @keyframes chartloader-trace {
          0% { stroke-dashoffset: 1; }
          55%, 100% { stroke-dashoffset: 0; }
        }
        @keyframes chartloader-head {
          0%, 50% { stroke-dashoffset: 1; }
          70%, 100% { stroke-dashoffset: 0; }
        }
        .chartloader-line {
          stroke-dasharray: 1;
          animation: chartloader-trace 2s ease-in-out infinite;
        }
        .chartloader-arrow {
          stroke-dasharray: 1;
          animation: chartloader-head 2s ease-in-out infinite;
        }
      `}</style>
      <path
        className="chartloader-line"
        d="M2 32 L14 24 L21 28 L33 13 L40 18 L55 6"
        pathLength={1}
      />
      <path className="chartloader-arrow" d="M48 6 L55 6 L55 13" pathLength={1} />
    </svg>
  )
}
