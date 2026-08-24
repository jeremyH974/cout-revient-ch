/**
 * Transport partagé : plusieurs abonnements sur un seul socket, **rejoués à chaque reconnexion**
 * (le défaut classique des implémentations naïves : un flux qui meurt en silence après la première
 * coupure), et « live » réservé aux messages de données — un accusé ne prouve pas que ça coule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveSocket, type LiveStatus, type SocketLike } from './socket';

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
  get subscriptions(): unknown[] {
    return this.sent
      .map((s) => JSON.parse(s) as { method?: string; subscription?: unknown })
      .filter((m) => m.method === 'subscribe')
      .map((m) => m.subscription);
  }
}

describe('createLiveSocket', () => {
  let sockets: FakeSocket[];
  let statuses: LiveStatus[];
  let messages: { channel: string; data: unknown }[];
  let subscriptions: unknown[];

  const build = () =>
    createLiveSocket({
      subscriptions: () => subscriptions,
      onMessage: (channel, data) => messages.push({ channel, data }),
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
    statuses = [];
    messages = [];
    subscriptions = [{ type: 'allMids' }, { type: 'userFills', user: '0xabc' }];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pose tous les abonnements à l’ouverture', () => {
    const live = build();
    live.start();
    sockets[0]!.onopen?.();
    expect(sockets[0]!.subscriptions).toEqual(subscriptions);
    live.stop();
  });

  it('les rejoue tous après une reconnexion, y compris ceux ajoutés entre-temps', () => {
    const live = build();
    live.start();
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    // Un compte est ajouté pendant la coupure : la liste est relue à la connexion suivante.
    subscriptions = [...subscriptions, { type: 'userFills', user: '0xdef' }];
    vi.advanceTimersByTime(1300);
    expect(sockets).toHaveLength(2);
    sockets[1]!.onopen?.();
    expect(sockets[1]!.subscriptions).toHaveLength(3);
    expect(sockets[1]!.subscriptions).toContainEqual({ type: 'userFills', user: '0xdef' });
    live.stop();
  });

  it('un accusé ne passe pas l’état à « live » ; une donnée oui', () => {
    const live = build();
    live.start();
    sockets[0]!.onopen?.();
    sockets[0]!.emit({ channel: 'subscriptionResponse', data: {} });
    expect(statuses).toEqual(['connecting']);
    sockets[0]!.emit({ channel: 'userFills', data: { user: '0xabc', fills: [] } });
    expect(statuses.at(-1)).toBe('live');
    expect(messages.map((m) => m.channel)).toEqual(['subscriptionResponse', 'userFills']);
    live.stop();
  });

  it('stop() ne laisse ni minuterie ni socket ouvert', () => {
    const live = build();
    live.start();
    sockets[0]!.onopen?.();
    live.stop();
    expect(sockets[0]!.closed).toBe(true);
    expect(statuses.at(-1)).toBe('off');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.sent.filter((s) => s.includes('ping'))).toHaveLength(0);
  });
});
