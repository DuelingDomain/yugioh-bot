import type Database from "better-sqlite3";
import type {
  APIApplicationCommandOptionChoice, RESTPostAPIChatInputApplicationCommandsJSONBody,
  InteractionReplyOptions, InteractionEditReplyOptions, ModalComponentData,
  ModalBuilder, REST, Client,
} from "discord.js";
import type { SharedAdminServices } from "./shared.js";
import type { ConfirmationStore } from "./confirm.js";
import type { Cooldown } from "./cooldown.js";

export type Access = "public" | "moderator" | "admin";
export type Stop = () => void | Promise<void>;
export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  moderatorRoleId?: string;
  modLogChannelId?: string;
  waitlistChannelId?: string;
  statusChannelId?: string;
  announceChannelId?: string;
  healthPath: string;
  /** Programmatic network-edge injection for integration tests. Never read from env. */
  restApi?: string;
}

export interface InteractionLike {
  id: string;
  guildId: string | null;
  channelId: string | null;
  user: { id: string; username: string; displayName: string };
  reply(message: InteractionReplyOptions): Promise<void>;
  editReply(message: InteractionEditReplyOptions): Promise<void>;
  deferReply(): Promise<void>;
  deferUpdate(): Promise<void>;
  showModal(modal: ModalBuilder | ModalComponentData): Promise<void>;
}
export interface CommandInteractionLike extends InteractionLike {
  commandName: string;
  options: {
    getSubcommand(required?: boolean): string | null;
    getSubcommandGroup(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getInteger(name: string, required?: boolean): number | null;
    getNumber(name: string, required?: boolean): number | null;
    getBoolean(name: string, required?: boolean): boolean | null;
    getUser(name: string, required?: boolean): InteractionLike["user"] | null;
    getRole(name: string, required?: boolean): { id: string; name: string; position: number } | null;
    getChannel(name: string, required?: boolean): { id: string; name: string | null; type: number } | null;
  };
}
export interface ButtonInteractionLike extends InteractionLike { customId: string }
export interface ModalInteractionLike extends InteractionLike {
  customId: string;
  fields: { getTextInputValue(name: string): string };
}
export interface AutocompleteInteractionLike {
  guildId: string | null;
  user: InteractionLike["user"];
  commandName: string;
  options: { getFocused(): { name: string; value: string } };
  respond(choices: APIApplicationCommandOptionChoice[]): Promise<void>;
}
export interface Handler<I> {
  access: Access;
  /** Default: deferReply. Use manual only to open a modal or autocomplete. */
  acknowledgement?: "deferReply" | "deferUpdate" | "manual";
  destructive?: boolean;
  execute(interaction: I, context: FeatureContext): Promise<void>;
}
export interface CommandModule extends Handler<CommandInteractionLike> {
  data: { toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  autocomplete?(interaction: AutocompleteInteractionLike, context: FeatureContext): Promise<void>;
}
export interface ComponentModule<I> extends Handler<I> {
  /** Includes the separator, for example wl:. Prefixes must not overlap. */
  prefix: string;
}
export interface FeatureModule {
  commands: readonly CommandModule[];
  buttons: readonly ComponentModule<ButtonInteractionLike>[];
  modals: readonly ComponentModule<ModalInteractionLike>[];
  start?(context: FeatureContext): Promise<Stop | void> | Stop | void;
}
export interface FeatureContext {
  db: Database.Database;
  config: BotConfig;
  client: Client;
  rest: REST;
  signal: AbortSignal;
  shared: SharedAdminServices;
  confirmations: ConfirmationStore;
  cooldown: Cooldown;
  audit(action: { actorDiscordId: string; action: string; targetDiscordId?: string; reason?: string; result: "success" | "failure" | "denied"; params?: Record<string, unknown> }): Promise<void>;
}
