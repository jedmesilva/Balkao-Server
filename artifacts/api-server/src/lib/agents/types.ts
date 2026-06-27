export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "interactive";

export interface AgentContext {
  from: string;
  messageId: string;
  timestamp: string;
  messageType: MessageType;
  text?: string;
  mediaId?: string;
  mediaMimeType?: string;
  mediaCaption?: string;
  interactiveReplyId?: string;
  interactiveReplyTitle?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  metadata: Record<string, unknown>;
}

export interface AgentResult {
  handled: boolean;
  reply?: string;
  metadata?: Record<string, unknown>;
}

export interface Agent {
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  canHandle(context: AgentContext): boolean | Promise<boolean>;
  process(context: AgentContext): Promise<AgentResult>;
}
