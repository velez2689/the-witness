export class FakeSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  listeners: Record<string, Array<(ev: unknown) => void>> = {};
  closedByClient = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
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
