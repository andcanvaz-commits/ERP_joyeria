const FAN_LINE_COUNT = 9;
const FAN_SPACING = 13;

function fanWavePath(yOffset: number): string {
  return `M -60 ${180 + yOffset} C 120 ${60 + yOffset}, 260 ${220 + yOffset}, 460 ${90 + yOffset} S 760 ${40 + yOffset}, 960 ${140 + yOffset}`;
}

// Fondo decorativo del login: olas suaves papel/oro con hilos dorados que se
// dibujan solos al cargar (stroke-dashoffset). Puramente visual.
export function LoginBackground() {
  return (
    <div aria-hidden="true" className="loginBgWrap">
      <svg preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="loginBlobA" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="#EAD9B4" />
            <stop offset="100%" stopColor="#F6F1E4" />
          </linearGradient>
          <linearGradient id="loginBlobB" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#F3E9D2" />
            <stop offset="100%" stopColor="#FBFAF7" />
          </linearGradient>
        </defs>

        <path
          d="M -100 620 C 150 480 300 700 520 560 C 760 410 900 640 1300 480 L1300 900 L-100 900 Z"
          fill="url(#loginBlobA)"
          opacity="0.7"
        />
        <path
          d="M -100 500 C 200 340 420 560 680 400 C 900 260 1050 430 1300 300 L1300 900 L-100 900 Z"
          fill="url(#loginBlobB)"
          opacity="0.6"
        />

        <g transform="translate(10 30) rotate(-14)">
          {Array.from({ length: FAN_LINE_COUNT }).map((_, index) => (
            <path
              className="loginLinePath"
              d={fanWavePath(index * FAN_SPACING)}
              key={index}
              pathLength={1}
              style={{
                animationDelay: `${index * -0.7}s`,
                animationDuration: `${8 + index * 0.6}s`,
              }}
            />
          ))}
        </g>

        <path
          className="loginLinePath loginLineAccent"
          d="M -60 520 C 220 380 360 680 620 520 C 860 380 1000 600 1300 460"
          pathLength={1}
          style={{ animationDelay: "-2.1s" }}
        />
        <path
          className="loginLinePath loginLineAccent loginLineAccentThin"
          d="M -60 546 C 220 406 360 706 620 546 C 860 406 1000 626 1300 486"
          pathLength={1}
          style={{ animationDelay: "-4.6s" }}
        />
      </svg>
    </div>
  );
}
