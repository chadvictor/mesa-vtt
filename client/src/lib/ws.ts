import type { WsEnvelope } from '@systems/types';
import { getAuthToken, getWsBaseUrl } from './api';

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type WsMessageHandler<T = unknown> = (payload: T, envelope: WsEnvelope<T>) => void;

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export class MesaWsClient {
  private ws: WebSocket | null = null;
  private campaignId: string;
  private status: WsConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private intentionallyClosed = false;
  private reqCounter = 0;
  private outgoingQueue: WsEnvelope[] = [];

  private typeListeners = new Map<string, Set<WsMessageHandler>>();
  private anyListeners = new Set<(env: WsEnvelope) => void>();
  private statusListeners = new Set<(status: WsConnectionStatus) => void>();

  constructor(campaignId: string) {
    this.campaignId = campaignId;
  }

  getStatus(): WsConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionallyClosed = false;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    const token = getAuthToken() ?? '';
    const base = getWsBaseUrl();
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}token=${encodeURIComponent(token)}&campaignId=${encodeURIComponent(this.campaignId)}`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();
        this.flushQueue();
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const env = JSON.parse(event.data) as WsEnvelope;
          if (!env || typeof env.type !== 'string') return;
          this.dispatch(env);
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.stopHeartbeat();
        this.ws = null;
        if (this.intentionallyClosed) {
          this.setStatus('disconnected');
          return;
        }
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.outgoingQueue = [];
    if (this.ws) {
      try {
        this.ws.close(1000, 'client_disconnect');
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  send<T = unknown>(type: string, payload: T, opts?: { queueIfOffline?: boolean }): string {
    const requestId = `req_${Date.now().toString(36)}_${++this.reqCounter}`;
    const envelope: WsEnvelope<T> = { type, requestId, payload };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(envelope));
      } catch {
        if (opts?.queueIfOffline) {
          this.outgoingQueue.push(envelope);
        }
      }
    } else if (opts?.queueIfOffline ?? !type.startsWith('voice.signal')) {
      if (this.outgoingQueue.length > 100) {
        this.outgoingQueue.shift();
      }
      this.outgoingQueue.push(envelope);
    }

    return requestId;
  }

  on<T = unknown>(type: string, handler: WsMessageHandler<T>): () => void {
    let set = this.typeListeners.get(type);
    if (!set) {
      set = new Set();
      this.typeListeners.set(type, set);
    }
    set.add(handler as WsMessageHandler);
    return () => {
      set?.delete(handler as WsMessageHandler);
      if (set && set.size === 0) {
        this.typeListeners.delete(type);
      }
    };
  }

  onAny(handler: (env: WsEnvelope) => void): () => void {
    this.anyListeners.add(handler);
    return () => {
      this.anyListeners.delete(handler);
    };
  }

  onStatus(handler: (status: WsConnectionStatus) => void): () => void {
    this.statusListeners.add(handler);
    handler(this.status);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  private dispatch(env: WsEnvelope): void {
    const listeners = this.typeListeners.get(env.type);
    if (listeners) {
      for (const fn of listeners) {
        try {
          fn(env.payload, env);
        } catch (err) {
          console.error(`[MesaWS] Handler error for ${env.type}:`, err);
        }
      }
    }
    for (const fn of this.anyListeners) {
      try {
        fn(env);
      } catch (err) {
        console.error('[MesaWS] Wildcard handler error:', err);
      }
    }
  }

  private setStatus(next: WsConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const fn of this.statusListeners) {
      fn(next);
    }
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const batch = this.outgoingQueue.splice(0, this.outgoingQueue.length);
    for (const env of batch) {
      try {
        this.ws.send(JSON.stringify(env));
      } catch {
        break;
      }
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping', { clientTime: Date.now() }, { queueIfOffline: false });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.setStatus('reconnecting');
    const delay = Math.min(1000 * Math.pow(1.6, this.reconnectAttempts), MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
