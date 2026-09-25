export class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  closedByClient = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  /**
   * Streaming STT takes raw PCM as BINARY frames while the Voice Agent takes base64 inside JSON,
   * so a fake that only understood JSON would throw on exactly the audio path it is meant to
   * cover. Binary frames are recorded as `{type:'binary'}` with their byte length.
   */
  send(data: string | ArrayBufferLike | ArrayBufferView) {
    if (typeof data !== 'string') {
      const bytes = 'byteLength' in data ? data.byteLength : 0;
      this.sent.push({ type: 'binary', bytes });
      return;
    }
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
    this.emit('close', {});
  }
  emit(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  server(msg: Record<string, unknown>) {
    this.emit('message', { data: JSON.stringify(msg) });
  }
}
