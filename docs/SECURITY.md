# Security model

Sort It Out deliberately has no accounts, passwords, email addresses or social login.

Each browser holds an invisible random session credential in local storage. The database stores
only its hash. A connected name cannot be claimed by another credential; after the heartbeat
timeout, entering the exact room code and display name can reclaim it from another device.

That produces one accepted tradeoff: anyone who knows both values can impersonate a disconnected
player. This is suitable for casual family play, not adversarial or prize-based competition.

The relaxed identity model does not expose secret rankings:

- anonymous roles cannot read or mutate core tables directly;
- all sensitive actions go through role- and phase-checked RPCs;
- scores and deadlines are calculated by Postgres;
- the Ranker's order and unfinished guesses are filtered from `get_game_state`;
- Realtime publishes only non-secret invalidation events; clients refetch role-specific state;
- the frontend never contains a service-role key.

Player names and custom cards are rendered as text, not HTML. There is no analytics collection.
