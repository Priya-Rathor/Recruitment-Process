// =============================================================================
// THE WAVEFORM.
//
// A REAL WAVE, NOT AN EQUALISER. The brief rules out bouncing bars, and it is
// right to: a row of randomly-jumping rectangles is the universal shorthand for
// "some audio is happening somewhere" and says nothing about a conversation.
// This is a single SVG path — a speech-shaped envelope drawn once and scrolled
// horizontally, which reads as a voice because a voice looks like that.
//
// THE PATH IS DETERMINISTIC. Its points come from a fixed formula evaluated at
// module load, so the server and the client draw identical markup. A random
// waveform is the textbook hydration mismatch, and it is also worse-looking:
// real speech has a rhythm and noise does not.
//
// SEAMLESS WITHOUT A LOOP SEAM. The wave is drawn twice, end to end, in a group
// that translates by exactly half its width. At the moment it snaps back, the
// second copy is exactly where the first was, so nothing visibly jumps.
//
// ANIMATION IS TRANSFORM ONLY — translateX on the group, scaleY on a wrapper.
// Both are compositor properties. Nothing here triggers layout, which matters
// because this is the one element on the page that is in motion for several
// seconds at a time.
//
// NO AUDIO. Not muted audio, not audio behind a click — there is no audio
// element in this component and no sound file in this section. The brief's
// autoplay rule is met by there being nothing to autoplay.
//
// A SERVER COMPONENT: the state comes in as a prop, and every state is a CSS
// class. There is no reason for this to ship any JavaScript.
// =============================================================================

/** How the wave should read. Each is a CSS state, not a different drawing. */
export type WaveState = "idle" | "ai" | "candidate" | "processing" | "complete";

const WIDTH = 240;
const HEIGHT = 40;
const MID = HEIGHT / 2;

/**
 * One cycle of a speech-shaped envelope.
 *
 * Two sines of different frequency multiplied by a slow third gives the
 * clustered loud-and-quiet pattern speech actually has — syllables inside
 * words, words inside phrases. A single sine reads as a test tone.
 */
function buildWave(): string {
  const points: string[] = [];
  for (let x = 0; x <= WIDTH; x += 3) {
    const t = (x / WIDTH) * Math.PI * 2;
    const envelope = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.5));
    const carrier = Math.sin(t * 9) * 0.7 + Math.sin(t * 17) * 0.3;
    const y = MID + carrier * envelope * (MID - 3);
    points.push(`${x},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

const WAVE = buildWave();

export function VoiceWaveform({ state }: { state: WaveState }) {
  return (
    <div className="vi-wave" data-state={state}>
      {/*
        `aria-hidden`, and the state is announced in text beside it. A waveform
        is not information a screen reader can use, and the brief's rule — do
        not rely on the waveform to communicate anything — is met by the label
        the component is rendered next to rather than by an alt string here.
      */}
      <svg
        className="vi-wave__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <g className="vi-wave__scroll">
          <polyline className="vi-wave__line" points={WAVE} />
          {/* The second copy, exactly one width along — see the header. */}
          <polyline
            className="vi-wave__line"
            points={WAVE}
            transform={`translate(${WIDTH} 0)`}
          />
        </g>
      </svg>
    </div>
  );
}
