/** Client WebSocket allMids : abonnement, mids filtrés, ping périodique, reconnexion, arrêt. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveMids, type LiveStatus, type SocketLike } from './live';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

describe('createLiveMids', () => {
  let sockets: FakeSocket[];
  let mids: Record<string, string>[];
  let statuses: LiveStatus[];

  const build = () =>
    createLiveMids({
      onMids: (m) => mids.push(m),
      onStatus: (s) => statuses.push(s),
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      pingMs: 1000,
      maxBackoffMs: 4000,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    mids = [];
    statuses = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('s’abonne à allMids à l’ouverture et pousse des mids filtrés', () => {
    const live = build();
    live.start();
    expect(statuses).toEqual(['connecting']);
    const socket = sockets[0]!;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      method: 'subscribe',
      subscription: { type: 'allMids' },
    });
    socket.emit({ channel: 'subscriptionResponse', data: {} });
    socket.emit({
      channel: 'allMids',
      data: { mids: { BTC: '65000.5', '@107': '0.42', '#11530': '1.0', BAD: 'nope' } },
    });
    expect(statuses.at(-1)).toBe('live');
    expect(mids).toEqual([{ BTC: '65000.5', '@107': '0.42', '#11530': '1.0' }]);
    live.stop();
    expect(socket.closed).toBe(true);
    expect(statuses.at(-1)).toBe('off');
  });

  it('envoie un ping périodique tant que le socket est ouvert', () => {
    const live = build();
    live.start();
    const socket = sockets[0]!;
    socket.onopen?.();
    vi.advanceTimersByTime(3100);
    const pings = socket.sent.filter((s) => s === JSON.stringify({ method: 'ping' }));
    expect(pings).toHaveLength(3);
    live.stop();
  });

  it('se reconnecte après une coupure avec backoff, et stop() annule tout', () => {
    const live = build();
    live.start();
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    expect(statuses.at(-1)).toBe('retry');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1300); // 1000 + jitter ≤ 200
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe('connecting');
    // Deuxième coupure : backoff double.
    sockets[1]!.onclose?.();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1500);
    expect(sockets).toHaveLength(3);
    live.stop();
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(3);
    expect(sockets[2]!.closed).toBe(true);
  });

  it('un start() double est sans effet ; un flux vivant remet le backoff à zéro', () => {
    const live = build();
    live.start();
    live.start();
    expect(sockets).toHaveLength(1);
    const socket = sockets[0]!;
    socket.onopen?.();
    socket.emit({ channel: 'allMids', data: { mids: { BTC: '1' } } });
    socket.onclose?.();
    // attempts remis à 0 par le message reçu → prochain essai à ~1 s.
    vi.advanceTimersByTime(1300);
    expect(sockets).toHaveLength(2);
    live.stop();
  });
});
