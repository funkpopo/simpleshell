/**
 * Type-level view of the IPC registry; no runtime imports.
 *
 * The registry in ./channels.js is plain JavaScript, but its define* helpers keep
 * keys, channel names and argument schemas as literal types. This file turns
 * those schemas into TypeScript argument tuples so `npm run typecheck` can verify
 * every `ipcRenderer.invoke`/`send` in the preload against the same schema that
 * main validates at runtime.
 */
import type { IpcRenderer } from "electron";

/** The JSON Schema subset the registry uses (Ajv validates it in main). */
export interface JsonSchema {
  readonly type?: "array" | "object" | "string" | "number" | "boolean" | "null";
  readonly items?: JsonSchema | readonly JsonSchema[];
  readonly additionalItems?: boolean | JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly properties?: { readonly [name: string]: JsonSchema };
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly anyOf?: readonly JsonSchema[];
}

export interface ArgsOptions {
  readonly minItems?: number;
  readonly maxItems?: number;
}

/** Positional argument schema produced by `args()`; `Min` is a literal count. */
export interface ArgsSchema<
  T extends readonly JsonSchema[],
  Min extends number = number,
> {
  readonly type: "array";
  readonly minItems: Min;
  readonly maxItems: number;
  readonly items: T;
}

export type MinItemsOf<T extends readonly unknown[], O> = O extends {
  readonly minItems: infer M extends number;
}
  ? M
  : T["length"];

/** Schema produced by `objectPayloadArgs(required, properties)`. */
export interface ObjectPayloadSchema<
  R extends readonly string[],
  P extends Readonly<Record<string, JsonSchema>>,
> {
  readonly type: "object";
  readonly required: R;
  readonly properties: P;
  readonly additionalProperties: true;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type PropertiesOf<S> = S extends { readonly properties: infer P } ? P : {};
type RequiredOf<S> = S extends {
  readonly required: readonly (infer R extends string)[];
}
  ? R
  : never;

/**
 * Object schemas without declared fields accept any object (including
 * interface-typed values such as Electron's dialog options). Declared fields
 * become typed members; `required` keys become mandatory.
 */
type ObjectSchemaType<S> = [keyof PropertiesOf<S> | RequiredOf<S>] extends [
  never,
]
  ? object
  : Simplify<
      {
        -readonly [
          K in keyof PropertiesOf<S> & string as K extends RequiredOf<S>
            ? K
            : never
        ]: SchemaType<PropertiesOf<S>[K]>;
      } & {
        -readonly [
          K in keyof PropertiesOf<S> & string as K extends RequiredOf<S>
            ? never
            : K
        ]?: SchemaType<PropertiesOf<S>[K]>;
      } & {
        [K in Exclude<RequiredOf<S>, keyof PropertiesOf<S>>]: unknown;
      }
    > & { [extra: string]: unknown };

/** TypeScript type accepted by a JSON schema fragment. `{}` means unknown. */
export type SchemaType<S> = S extends {
  readonly enum: readonly (infer E)[];
}
  ? E
  : S extends { readonly anyOf: readonly (infer A)[] }
    ? SchemaType<A>
    : S extends { readonly type: "string" }
      ? string
      : S extends { readonly type: "number" }
        ? number
        : S extends { readonly type: "boolean" }
          ? boolean
          : S extends { readonly type: "null" }
            ? null
            : S extends { readonly type: "array" }
              ? readonly unknown[]
              : S extends { readonly type: "object" }
                ? ObjectSchemaType<S>
                : unknown;

type SchemaTypes<T extends readonly unknown[]> = {
  -readonly [I in keyof T]: SchemaType<T[I]>;
};

type BuildArgs<
  T extends readonly unknown[],
  Min extends number,
  Acc extends unknown[] = [],
> = Acc["length"] extends Min
  ? [...Acc, ...Partial<SchemaTypes<T>>]
  : T extends readonly [infer Head, ...infer Rest]
    ? BuildArgs<Rest, Min, [...Acc, SchemaType<Head>]>
    : Acc;

/** Argument tuple accepted by an argument-list schema. */
export type ArgsOf<S> = S extends { readonly maxItems: 0 }
  ? []
  : S extends {
        readonly items: infer T extends readonly unknown[];
        readonly minItems: infer Min extends number;
      }
    ? BuildArgs<T, Min>
    : unknown[];

type Definitions =
  (typeof import("./channels"))["IPC_CHANNEL_DEFINITIONS"][number];
type RequestDefinitions = Extract<Definitions, { type: "request" }>;
type EventDefinitions = Extract<Definitions, { type: "event" }>;

/** `IPC_REQUEST_CHANNELS`: constant name → wire channel. */
export type IpcRequestChannelMap = {
  readonly [D in RequestDefinitions as D["key"]]: D["channel"];
};
/** `IPC_EVENT_CHANNELS`: constant name → wire channel (`*` = dynamic). */
export type IpcEventChannelMap = {
  readonly [D in EventDefinitions as D["key"]]: D["channel"];
};

export type IpcRequestKey = RequestDefinitions["key"];
export type IpcEventKey = EventDefinitions["key"];
export type IpcRequestChannel = RequestDefinitions["channel"];
export type IpcEventChannel = EventDefinitions["channel"];
export type IpcDynamicEventKey = Extract<
  EventDefinitions,
  { channel: `${string}*${string}` }
>["key"];

export type IpcRequestArgs<C extends IpcRequestChannel> = ArgsOf<
  Extract<RequestDefinitions, { channel: C }>["requestSchema"]
>;
export type IpcEventArgs<C extends IpcEventChannel> = ArgsOf<
  Extract<EventDefinitions, { channel: C }>["payloadSchema"]
>;

/**
 * Responses with a shape main guarantees, declared next to each domain's
 * channels. Every other request resolves to `unknown` and must be narrowed.
 */
export type IpcKnownResponses = import("./domains/app").AppResponses &
  import("./domains/ai").AiResponses &
  import("./domains/terminal").TerminalResponses &
  import("./domains/connection").ConnectionResponses &
  import("./domains/files").FileResponses &
  import("./domains/transfers").TransferResponses &
  import("./domains/settings").SettingsResponses &
  import("./domains/batch").BatchResponses;

export type IpcResponse<C extends IpcRequestChannel> = Extract<
  RequestDefinitions,
  { channel: C }
>["key"] extends infer K
  ? K extends keyof IpcKnownResponses
    ? IpcKnownResponses[K]
    : unknown
  : never;

/**
 * The preload's view of `ipcRenderer`: identical at runtime, but `invoke` and
 * `send` only accept registered channels with schema-conforming arguments.
 */
export interface ContractIpcRenderer extends Omit<
  IpcRenderer,
  "invoke" | "send"
> {
  invoke<C extends IpcRequestChannel>(
    channel: C,
    ...args: IpcRequestArgs<C>
  ): Promise<IpcResponse<C>>;
  send<C extends IpcEventChannel>(channel: C, ...args: IpcEventArgs<C>): void;
}
