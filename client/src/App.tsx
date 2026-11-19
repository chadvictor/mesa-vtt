import React, { useEffect, useState } from 'react';
import {
  authSSOTicket,
  clearAuthSession,
  getAuthToken,
  getCachedUser,
  getMe,
  getServerConfig,
  joinCampaign,
  parseLaunchParams,
  setAuthSession,
} from '@/lib/api';
import type {
  Campaign,
  MemberRole,
  ServerPublicConfig,
  UserIdentity,
} from '@systems/types';
import { QuickLoginView } from '@/components/lobby/QuickLoginView';
import { CampaignLobby } from '@/components/lobby/CampaignLobby';
import { TableShell } from '@/components/layout/TableShell';

interface ActiveTableState {
  campaignId: string;
  role: MemberRole;
}

const DEFAULT_CONFIG: ServerPublicConfig = {
  authMode: 'local',
  localAuthEnabled: true,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  systems: ['mighty-blade-3e', 'generic-rpg'],
};

export function App() {
  const [serverConfig, setServerConfig] = useState<ServerPublicConfig>(DEFAULT_CONFIG);
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [booting, setBooting] = useState(true);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<ActiveTableState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const launch = parseLaunchParams();

      // 1. Fetch public server config (authMode + ICE/STUN/TURN servers)
      let cfg = DEFAULT_CONFIG;
      try {
        cfg = await getServerConfig();
        if (!cancelled) setServerConfig(cfg);
      } catch {
        // Keep safe default config
      }

      // 2. Optional external SSO launch ticket handshake (?ticket=...)
      if (launch.ticket) {
        try {
          const authRes = await authSSOTicket({
            ticket: launch.ticket,
            roomId: launch.roomCode,
            create: launch.create,
          });
          if (cancelled) return;
          setAuthSession(authRes.token, authRes.user);
          setUser(authRes.user);

          // Strip one-time ticket from browser URL bar so refresh doesn't replay it
          try {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('ticket');
            window.history.replaceState({}, '', cleanUrl.toString());
          } catch {
            // Ignore history restrictions
          }

          // Auto-join target campaign room if a specific invite code was passed
          const roomCode = (authRes.launchRoomId ?? launch.roomCode ?? '').trim().toUpperCase();
          if (roomCode && roomCode !== 'LOBBY') {
            try {
              const joined = await joinCampaign({ inviteCode: roomCode });
              if (!cancelled && joined.campaign) {
                setActiveTable({
                  campaignId: joined.campaign.id,
                  role: joined.member?.role ?? 'player',
                });
              }
            } catch {
              // Fall back to Lobby if room code not found
            }
          }
          setBooting(false);
          return;
        } catch (err) {
          if (!cancelled) {
            setSsoError(
              err instanceof Error
                ? `Falha ao validar ticket SSO: ${err.message}`
                : 'Falha ao validar ticket SSO.'
            );
            setBooting(false);
          }
          return;
        }
      }

      // 3. Existing session token restore
      const existingToken = getAuthToken();
      if (existingToken) {
        try {
          const me = await getMe();
          if (!cancelled && me?.user) {
            setUser(me.user);
            setBooting(false);
            return;
          }
        } catch {
          clearAuthSession();
        }
      } else {
        // Clear any stale cached user without token
        if (getCachedUser()) {
          clearAuthSession();
        }
      }

      if (!cancelled) {
        setBooting(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticated = (token: string, nextUser: UserIdentity) => {
    setAuthSession(token, nextUser);
    setUser(nextUser);
    setSsoError(null);
  };

  const handleSignOut = () => {
    clearAuthSession();
    setActiveTable(null);
    setUser(null);
  };

  const handleEnterCampaign = (campaign: Campaign, role: MemberRole) => {
    setActiveTable({ campaignId: campaign.id, role });
  };

  if (booting || !user) {
    return (
      <QuickLoginView
        onAuthenticated={handleAuthenticated}
        ssoLoading={booting}
        ssoError={ssoError}
        localAuthEnabled={serverConfig.localAuthEnabled}
      />
    );
  }

  if (activeTable) {
    return (
      <TableShell
        campaignId={activeTable.campaignId}
        user={user}
        initialRole={activeTable.role}
        iceServers={serverConfig.iceServers}
        onBackToLobby={() => setActiveTable(null)}
      />
    );
  }

  return (
    <CampaignLobby
      user={user}
      localAuthEnabled={serverConfig.localAuthEnabled}
      onEnterCampaign={handleEnterCampaign}
      onSignOut={handleSignOut}
    />
  );
}

export default App;
