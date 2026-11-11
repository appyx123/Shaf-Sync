/**
 * Server-Sent Events (SSE) Hub Lokal
 * Mengirimkan event real-time (DATA_UPDATED, TIME_RESYNCED) ke Chromium Kiosk
 */
export class SseHub {
  constructor() {
    this.clients = new Set();
  }

  addClient(controller) {
    this.clients.add(controller);
  }

  removeClient(controller) {
    this.clients.delete(controller);
  }

  broadcast(event, payload = {}) {
    const message = `event: ${event}\ndata: ${JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...payload
    })}\n\n`;
    const encoded = new TextEncoder().encode(message);

    for (const controller of this.clients) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.clients.delete(controller);
      }
    }
  }
}
