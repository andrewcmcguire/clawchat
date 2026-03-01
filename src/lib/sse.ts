const encoder = new TextEncoder();

// Global SSE client set — shared across all API routes in the same process
const globalForSSE = globalThis as unknown as {
  sseClients?: Set<ReadableStreamDefaultController>;
};

if (!globalForSSE.sseClients) {
  globalForSSE.sseClients = new Set();
}

export const clients = globalForSSE.sseClients;

export function addClient(controller: ReadableStreamDefaultController) {
  clients.add(controller);
}

export function removeClient(controller: ReadableStreamDefaultController) {
  clients.delete(controller);
}

export function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.enqueue(encoder.encode(payload));
    } catch {
      clients.delete(client);
    }
  }
}
