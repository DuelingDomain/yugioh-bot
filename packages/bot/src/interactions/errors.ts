import { isCardFetchError } from "@yugidraft/shared/services";

type ErrorInteraction = {
  isAutocomplete(): boolean;
  isRepliable(): boolean;
  deferred?: boolean;
  replied?: boolean;
  respond?(choices: []): Promise<unknown>;
  reply?(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  followUp?(options: { content: string; ephemeral: boolean }): Promise<unknown>;
};

/** Discord event listeners do not await their returned promises. Contain reply failures too. */
export async function reportInteractionError(interaction: ErrorInteraction, error: unknown): Promise<void> {
  try {
    if (interaction.isAutocomplete()) { await interaction.respond?.([]); return; }
    if (!interaction.isRepliable()) return;
    const content = isCardFetchError(error) ? "Card database is unavailable. Try again shortly."
      : error instanceof Error ? error.message : "Something went wrong";
    const options = { content, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp?.(options);
    else await interaction.reply?.(options);
  } catch (replyError) { console.error("[bot] Could not send the error reply", replyError); }
}
