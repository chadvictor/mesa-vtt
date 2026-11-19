/**
 * Discord-style WebRTC P2P Audio Mesh Manager for Mesa VTT.
 *
 * Key invariants:
 * - Mounted once at TableShell level so switching mobile tabs NEVER disconnects voice.
 * - Glare-free signaling: joiner initiates offers to existing peers, PLUS polite/impolite
 *   tie-breaking (`myUserId < remoteUserId`) so simultaneous joins or ICE restarts resolve cleanly.
 * - Listen-only graceful fallback when mic permission is denied or unavailable.
 * - Mobile Safari / Android AudioContext unlock inside user gesture + per-peer GainNode (0..200%).
 */

import type { IceServerConfig, VoiceChannel, VoiceParticipant, VoiceSignalPayload } from '@systems/types';
import { VoiceActivityDetector } from './vad';

export type VoiceConnectionState = 'idle' | 'joining' | 'connected' | 'reconnecting';
export type PeerLinkStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface VoiceStateSnapshot {
  status: VoiceConnectionState;
  activeChannelId: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  micLevel: number;
  listenOnly: boolean;
  micError: string | null;
  peerVolumes: Record<string, number>; // 0..2 (default 1 = 100%)
  peerStatuses: Record<string, PeerLinkStatus>;
  remoteSpeaking: Record<string, boolean>;
}

export interface VoiceTransport {
  sendVoiceJoin: (channelId: string) => void;
  sendVoiceLeave: () => void;
  sendVoiceStatus: (status: { muted: boolean; deafened: boolean; speaking: boolean }) => void;
  sendVoiceSignal: (signal: VoiceSignalPayload) => void;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

interface PeerEntry {
  userId: string;
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  audioEl: HTMLAudioElement;
  gainNode: GainNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  status: PeerLinkStatus;
  iceRestartTimer: number | null;
}

export class VoiceMeshManager {
  private readonly myUserId: string;
  private readonly transport: VoiceTransport;
  private iceServers: RTCIceServer[];

  private audioCtx: AudioContext | null = null;
  private localStream: MediaStream | null = null;
  private vad: VoiceActivityDetector | null = null;
  private peers = new Map<string, PeerEntry>();
  private audioContainer: HTMLDivElement | null = null;

  private status: VoiceConnectionState = 'idle';
  private activeChannelId: string | null = null;
  private muted = false;
  private deafened = false;
  private mutedBeforeDeafen = false;
  private speaking = false;
  private micLevel = 0;
  private listenOnly = false;
  private micError: string | null = null;
  private peerVolumes: Record<string, number> = {};
  private remoteSpeaking: Record<string, boolean> = {};

  private lastStatusEmitAt = 0;
  private pendingStatusTimer: number | null = null;
  private listeners = new Set<(snap: VoiceStateSnapshot) => void>();

  constructor(
    myUserId: string,
    transport: VoiceTransport,
    iceServers?: IceServerConfig[]
  ) {
    this.myUserId = myUserId;
    this.transport = transport;
    this.iceServers =
      iceServers && iceServers.length > 0
        ? (iceServers as RTCIceServer[])
        : DEFAULT_ICE_SERVERS;
  }

  setIceServers(servers: IceServerConfig[] | undefined): void {
    if (servers && servers.length > 0) {
      this.iceServers = servers as RTCIceServer[];
    }
  }

  subscribe(listener: (snap: VoiceStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): VoiceStateSnapshot {
    const peerStatuses: Record<string, PeerLinkStatus> = {};
    for (const [uid, entry] of this.peers) {
      peerStatuses[uid] = entry.status;
    }
    return {
      status: this.status,
      activeChannelId: this.activeChannelId,
      muted: this.muted,
      deafened: this.deafened,
      speaking: this.speaking,
      micLevel: this.micLevel,
      listenOnly: this.listenOnly,
      micError: this.micError,
      peerVolumes: { ...this.peerVolumes },
      peerStatuses,
      remoteSpeaking: { ...this.remoteSpeaking },
    };
  }

  /** Must be called synchronously inside a user tap/click to unlock iOS/Android audio. */
  unlockAudio(): void {
    if (typeof window === 'undefined') return;
    if (!this.audioCtx) {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor) {
        try {
          this.audioCtx = new AudioCtxCtor();
        } catch {
          this.audioCtx = null;
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {});
    }
    // Resume any paused remote audio elements
    for (const entry of this.peers.values()) {
      void entry.audioEl.play().catch(() => {});
    }
  }

  async joinChannel(channelId: string, existingParticipants: VoiceParticipant[] = []): Promise<void> {
    this.unlockAudio();

    if (this.activeChannelId === channelId && this.status === 'connected') {
      return;
    }

    // If switching channels, tear down old peers cleanly while keeping mic stream alive!
    const switching = this.activeChannelId !== null && this.activeChannelId !== channelId;
    if (switching) {
      this.closeAllPeers();
      this.transport.sendVoiceLeave();
    }

    this.status = 'joining';
    this.activeChannelId = channelId;
    this.micError = null;
    this.emitSnapshot();

    // Acquire local microphone stream if we don't already have one
    if (!this.localStream) {
      await this.acquireMicrophone();
    }

    // Notify server we joined this channel
    this.transport.sendVoiceJoin(channelId);
    this.status = 'connected';
    this.emitVoiceStatus(true);
    this.emitSnapshot();

    // Glare-free rule: joiner initiates connections to all peers already present
    for (const p of existingParticipants) {
      if (p.userId && p.userId !== this.myUserId) {
        await this.ensurePeerAndOffer(p.userId);
      }
    }
  }

  async retryMicrophone(): Promise<void> {
    this.unlockAudio();
    this.micError = null;
    this.stopLocalStream();
    await this.acquireMicrophone();

    if (this.localStream && !this.listenOnly) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !this.muted && !this.deafened;
        // Replace or add track on every active peer and renegotiate
        for (const entry of this.peers.values()) {
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'audio' || !s.track);
          if (sender) {
            try {
              await sender.replaceTrack(audioTrack);
            } catch {
              entry.pc.addTrack(audioTrack, this.localStream);
            }
          } else {
            entry.pc.addTrack(audioTrack, this.localStream);
          }
          // Make sure transceiver direction allows sending
          for (const tr of entry.pc.getTransceivers()) {
            if (tr.receiver.track?.kind === 'audio' || tr.sender.track?.kind === 'audio') {
              tr.direction = 'sendrecv';
            }
          }
          await this.createAndSendOffer(entry);
        }
      }
    }

    this.emitVoiceStatus(true);
    this.emitSnapshot();
  }

  leaveChannel(): void {
    const wasInChannel = this.activeChannelId !== null;
    this.closeAllPeers();
    this.stopLocalStream();
    this.activeChannelId = null;
    this.status = 'idle';
    this.speaking = false;
    this.micLevel = 0;
    this.listenOnly = false;
    this.micError = null;
    if (wasInChannel) {
      this.transport.sendVoiceLeave();
    }
    this.emitSnapshot();
  }

  toggleMute(): void {
    this.unlockAudio();
    if (this.listenOnly) {
      void this.retryMicrophone();
      return;
    }
    if (this.deafened && this.muted) {
      // Unmuting while deafened also undeafens (Discord behavior)
      this.deafened = false;
      this.applyAllPeerVolumes();
    }
    this.muted = !this.muted;
    this.applyLocalTrackEnabled();
    this.emitVoiceStatus(true);
    this.emitSnapshot();
  }

  toggleDeafen(): void {
    this.unlockAudio();
    if (!this.deafened) {
      this.mutedBeforeDeafen = this.muted;
      this.deafened = true;
      this.muted = true;
    } else {
      this.deafened = false;
      this.muted = this.mutedBeforeDeafen;
    }
    this.applyLocalTrackEnabled();
    this.applyAllPeerVolumes();
    this.emitVoiceStatus(true);
    this.emitSnapshot();
  }

  setPeerVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(2, volume));
    this.peerVolumes[userId] = clamped;
    const entry = this.peers.get(userId);
    if (entry) {
      this.applyPeerVolume(entry);
    }
    this.emitSnapshot();
  }

  /**
   * Called whenever `voice.state` arrives from server.
   * Reconciles peer list: tears down peers who left, and initiates offers to peers
   * missing from our mesh (only if we are not already connected and tie-break allows).
   */
  handleVoiceState(channels: VoiceChannel[]): void {
    if (!this.activeChannelId) return;
    const currentChannel = channels.find((c) => c.id === this.activeChannelId);
    if (!currentChannel) {
      // Channel was removed
      this.leaveChannel();
      return;
    }

    const activePeerIds = new Set<string>();
    for (const p of currentChannel.participants) {
      if (p.userId !== this.myUserId) {
        activePeerIds.add(p.userId);
        this.remoteSpeaking[p.userId] = p.speaking;
      }
    }

    // Remove peers who left our channel
    for (const peerId of Array.from(this.peers.keys())) {
      if (!activePeerIds.has(peerId)) {
        this.removePeer(peerId);
      }
    }

    // Ensure connections to peers who are in our channel if not yet created
    // Use deterministic initiator rule for any peer we haven't connected to yet
    for (const peerId of activePeerIds) {
      if (!this.peers.has(peerId) && this.myUserId > peerId) {
        void this.ensurePeerAndOffer(peerId);
      }
    }
  }

  /** Handles incoming WebRTC offer, answer, or ICE candidate relayed over campaign WS. */
  async handleSignal(signal: VoiceSignalPayload): Promise<void> {
    const fromUserId = signal.fromUserId;
    if (!fromUserId || fromUserId === this.myUserId || !this.activeChannelId) {
      return;
    }

    const entry = this.getOrCreatePeer(fromUserId);

    try {
      if (signal.kind === 'offer' && signal.sdp) {
        const desc = signal.sdp as RTCSessionDescriptionInit;
        const offerCollision =
          entry.makingOffer || entry.pc.signalingState !== 'stable';
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) {
          return;
        }

        if (offerCollision) {
          await Promise.all([
            entry.pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit).catch(() => {}),
            entry.pc.setRemoteDescription(desc),
          ]);
        } else {
          await entry.pc.setRemoteDescription(desc);
        }

        await this.flushPendingCandidates(entry);

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);

        this.transport.sendVoiceSignal({
          targetUserId: fromUserId,
          kind: 'answer',
          sdp: entry.pc.localDescription?.toJSON() ?? answer,
        });
      } else if (signal.kind === 'answer' && signal.sdp) {
        if (entry.pc.signalingState === 'have-local-offer') {
          await entry.pc.setRemoteDescription(signal.sdp as RTCSessionDescriptionInit);
          await this.flushPendingCandidates(entry);
        }
      } else if (signal.kind === 'ice' && signal.candidate) {
        const cand = signal.candidate as RTCIceCandidateInit;
        if (entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
          try {
            await entry.pc.addIceCandidate(cand);
          } catch {
            if (!entry.ignoreOffer) {
              // Ignore benign late candidate
            }
          }
        } else {
          entry.pendingCandidates.push(cand);
        }
      }
    } catch (err) {
      console.warn(`[VoiceMesh] Signal handling error (${signal.kind} from ${fromUserId}):`, err);
    }
  }

  /** Re-syncs channel membership after WebSocket reconnect without dropping user intent. */
  handleWsReconnect(): void {
    if (this.activeChannelId && this.status !== 'idle') {
      this.transport.sendVoiceJoin(this.activeChannelId);
      this.emitVoiceStatus(true);
    }
  }

  destroy(): void {
    this.leaveChannel();
    if (this.pendingStatusTimer !== null) {
      window.clearTimeout(this.pendingStatusTimer);
      this.pendingStatusTimer = null;
    }
    if (this.audioContainer && this.audioContainer.parentNode) {
      this.audioContainer.parentNode.removeChild(this.audioContainer);
      this.audioContainer = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      void this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async acquireMicrophone(): Promise<void> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.listenOnly = true;
      this.muted = true;
      this.micError =
        'Microfone indisponível neste navegador (use HTTPS ou localhost). Conectado em Modo Ouvinte.';
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localStream = stream;
      this.listenOnly = false;
      this.micError = null;
      this.applyLocalTrackEnabled();

      // Setup VAD
      this.vad?.destroy();
      this.vad = new VoiceActivityDetector(
        stream,
        {
          startThreshold: 0.032,
          stopThreshold: 0.018,
          holdMs: 320,
          onSpeakingChange: (isSpeaking) => {
            this.speaking = isSpeaking && !this.muted && !this.deafened;
            this.emitVoiceStatus(false);
            this.emitSnapshot();
          },
          onLevel: (level) => {
            if (Math.abs(level - this.micLevel) > 0.04) {
              this.micLevel = level;
              this.emitSnapshot();
            }
          },
        },
        this.audioCtx ?? undefined
      );
      this.vad.setMuted(this.muted || this.deafened);
    } catch (err) {
      this.listenOnly = true;
      this.muted = true;
      const errName = err instanceof DOMException ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        this.micError =
          'Permissão do microfone negada. Você está em Modo Ouvinte — libere o microfone no navegador e clique para tentar novamente.';
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        this.micError =
          'Nenhum microfone detectado. Conectado em Modo Ouvinte para ouvir a mesa.';
      } else {
        this.micError =
          'Não foi possível acessar o microfone. Conectado em Modo Ouvinte.';
      }
    }
  }

  private stopLocalStream(): void {
    this.vad?.destroy();
    this.vad = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
  }

  private applyLocalTrackEnabled(): void {
    const enabled = !this.muted && !this.deafened && !this.listenOnly;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = enabled;
      }
    }
    this.vad?.setMuted(!enabled);
    if (!enabled) {
      this.speaking = false;
    }
  }

  private async ensurePeerAndOffer(remoteUserId: string): Promise<void> {
    const entry = this.getOrCreatePeer(remoteUserId);
    await this.createAndSendOffer(entry);
  }

  private getOrCreatePeer(remoteUserId: string): PeerEntry {
    const existing = this.peers.get(remoteUserId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');
    audioEl.dataset.peerId = remoteUserId;
    this.ensureAudioContainer().appendChild(audioEl);

    const entry: PeerEntry = {
      userId: remoteUserId,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      polite: this.myUserId < remoteUserId,
      pendingCandidates: [],
      audioEl,
      gainNode: null,
      sourceNode: null,
      status: 'connecting',
      iceRestartTimer: null,
    };

    // Attach local audio or recvonly transceiver for listen-only mode
    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.transport.sendVoiceSignal({
          targetUserId: remoteUserId,
          kind: 'ice',
          candidate: ev.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      entry.audioEl.srcObject = stream;
      this.attachPeerGainGraph(entry, stream);
      this.applyPeerVolume(entry);
      void entry.audioEl.play().catch(() => {});
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        entry.status = 'connected';
        if (entry.iceRestartTimer !== null) {
          window.clearTimeout(entry.iceRestartTimer);
          entry.iceRestartTimer = null;
        }
      } else if (state === 'checking' || state === 'new') {
        entry.status = 'connecting';
      } else if (state === 'disconnected') {
        entry.status = 'disconnected';
        this.scheduleIceRestart(entry, 3500);
      } else if (state === 'failed') {
        entry.status = 'failed';
        this.scheduleIceRestart(entry, 500);
      }
      this.emitSnapshot();
    };

    this.peers.set(remoteUserId, entry);
    this.emitSnapshot();
    return entry;
  }

  private async createAndSendOffer(entry: PeerEntry): Promise<void> {
    if (entry.makingOffer) return;
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer({ offerToReceiveAudio: true });
      if (entry.pc.signalingState !== 'stable') return;
      await entry.pc.setLocalDescription(offer);
      this.transport.sendVoiceSignal({
        targetUserId: entry.userId,
        kind: 'offer',
        sdp: entry.pc.localDescription?.toJSON() ?? offer,
      });
    } catch (err) {
      console.warn(`[VoiceMesh] Offer creation failed for ${entry.userId}:`, err);
    } finally {
      entry.makingOffer = false;
    }
  }

  private scheduleIceRestart(entry: PeerEntry, delayMs: number): void {
    // Only the polite peer initiates ICE restart to prevent double restarts
    if (!entry.polite) return;
    if (entry.iceRestartTimer !== null) return;
    entry.iceRestartTimer = window.setTimeout(async () => {
      entry.iceRestartTimer = null;
      if (!this.peers.has(entry.userId)) return;
      if (entry.pc.iceConnectionState === 'connected' || entry.pc.iceConnectionState === 'completed') {
        return;
      }
      try {
        entry.makingOffer = true;
        const offer = await entry.pc.createOffer({ iceRestart: true, offerToReceiveAudio: true });
        await entry.pc.setLocalDescription(offer);
        this.transport.sendVoiceSignal({
          targetUserId: entry.userId,
          kind: 'offer',
          sdp: entry.pc.localDescription?.toJSON() ?? offer,
        });
      } catch {
        // Ignore restart failure
      } finally {
        entry.makingOffer = false;
      }
    }, delayMs);
  }

  private async flushPendingCandidates(entry: PeerEntry): Promise<void> {
    const queue = entry.pendingCandidates.splice(0, entry.pendingCandidates.length);
    for (const c of queue) {
      try {
        await entry.pc.addIceCandidate(c);
      } catch {
        // Ignore stale candidate
      }
    }
  }

  private attachPeerGainGraph(entry: PeerEntry, stream: MediaStream): void {
    if (!this.audioCtx) return;
    try {
      entry.sourceNode?.disconnect();
      entry.gainNode?.disconnect();
      // Route remote stream through Web Audio GainNode for 0..200% per-peer volume boost
      const source = this.audioCtx.createMediaStreamSource(stream);
      const gain = this.audioCtx.createGain();
      source.connect(gain);
      gain.connect(this.audioCtx.destination);
      entry.sourceNode = source;
      entry.gainNode = gain;
      // Mute the raw HTMLAudioElement so we don't double-play audio (keep it playing for Chrome WebRTC bug)
      entry.audioEl.muted = true;
    } catch {
      // Fallback: play directly via HTMLAudioElement
      entry.sourceNode = null;
      entry.gainNode = null;
      entry.audioEl.muted = false;
    }
  }

  private applyPeerVolume(entry: PeerEntry): void {
    const vol = this.deafened ? 0 : (this.peerVolumes[entry.userId] ?? 1);
    if (entry.gainNode && this.audioCtx) {
      entry.gainNode.gain.setTargetAtTime(vol, this.audioCtx.currentTime, 0.02);
      entry.audioEl.muted = true;
    } else {
      entry.audioEl.muted = this.deafened || vol <= 0.001;
      entry.audioEl.volume = Math.max(0, Math.min(1, vol));
    }
  }

  private applyAllPeerVolumes(): void {
    for (const entry of this.peers.values()) {
      this.applyPeerVolume(entry);
    }
  }

  private removePeer(userId: string): void {
    const entry = this.peers.get(userId);
    if (!entry) return;
    if (entry.iceRestartTimer !== null) {
      window.clearTimeout(entry.iceRestartTimer);
    }
    try {
      entry.sourceNode?.disconnect();
      entry.gainNode?.disconnect();
    } catch {
      // Ignore
    }
    try {
      entry.pc.close();
    } catch {
      // Ignore
    }
    entry.audioEl.srcObject = null;
    if (entry.audioEl.parentNode) {
      entry.audioEl.parentNode.removeChild(entry.audioEl);
    }
    this.peers.delete(userId);
    delete this.remoteSpeaking[userId];
    this.emitSnapshot();
  }

  private closeAllPeers(): void {
    for (const userId of Array.from(this.peers.keys())) {
      this.removePeer(userId);
    }
  }

  private ensureAudioContainer(): HTMLDivElement {
    if (!this.audioContainer) {
      const div = document.createElement('div');
      div.id = 'mesa-vtt-voice-sinks';
      div.style.display = 'none';
      document.body.appendChild(div);
      this.audioContainer = div;
    }
    return this.audioContainer;
  }

  private emitVoiceStatus(immediate: boolean): void {
    if (!this.activeChannelId) return;
    const now = performance.now();
    const minGap = 200; // max 5 Hz
    const send = () => {
      this.lastStatusEmitAt = performance.now();
      this.transport.sendVoiceStatus({
        muted: this.muted,
        deafened: this.deafened,
        speaking: this.speaking,
      });
    };

    if (immediate || now - this.lastStatusEmitAt >= minGap) {
      if (this.pendingStatusTimer !== null) {
        window.clearTimeout(this.pendingStatusTimer);
        this.pendingStatusTimer = null;
      }
      send();
    } else if (this.pendingStatusTimer === null) {
      this.pendingStatusTimer = window.setTimeout(() => {
        this.pendingStatusTimer = null;
        send();
      }, minGap - (now - this.lastStatusEmitAt));
    }
  }

  private emitSnapshot(): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      fn(snap);
    }
  }
}
