/**
 * Reads a line aloud with the browser's voice. This is text-to-speech of the transcript, not a
 * recording, and the buttons that call it say "Read aloud" for that reason: the scripted corpus
 * has no audio, and playing a live call's recorded span is a separate control. Client-only; never
 * throws.
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
