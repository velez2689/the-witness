/**
 * Plays a line with the browser's voice. This is the SCRIPTED path: it stands in for the recorded
 * call audio until the rendered corpus is wired in. Client-only; never throws.
 */
export function speak(text: string, voiceHint: 'rep' | 'witness' = 'rep'): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = voiceHint === 'witness' ? 1.02 : 0.96;
    u.pitch = voiceHint === 'witness' ? 1.1 : 0.85;
    window.speechSynthesis.speak(u);
  } catch {
    /* audio is a convenience, never a dependency */
  }
}
