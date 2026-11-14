/**
 * Player voice talk on the table. Off: players use Discord or similar. No voice room connection, no voice token and no microphone for talk.
 * Voice commands are separate (REMOTE_VOICE_USERS, delivered in the room response). The talk code stays for a later choice. Browser code reads this too.
 */
export const REMOTE_TABLE_TALK = false as boolean;
