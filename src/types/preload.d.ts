/** Shared type declarations for the preload bridge; no runtime imports. */
import type { IpcRendererEvent } from "electron";

export type ProcessId = string | number;
export type Unsubscribe = () => void;
export type PayloadCallback<T = unknown> = (payload: T) => void;
export type IpcCallback<T = unknown> = (
  event: IpcRendererEvent,
  payload: T,
) => void;
export type ReconnectCallback = (event: null, payload: unknown) => void;
export type ExternalEditorCallback = PayloadCallback & {
  _wrappedCallback?: IpcCallback;
};

export type TerminalMailboxMessage =
  | { type: "input"; data: string }
  | { type: "output"; data: string | Uint8Array }
  | { type: "ack"; bytes: number }
  | { type: "resize"; cols: number; rows: number; immediate?: boolean }
  | { type: "pause" | "resume" };

export interface WindowState {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface ExternalOpenOptions {
  allowRestrictedProtocols?: boolean;
  source?: string;
}

export interface ExternalOpenResult {
  success: boolean;
  error?: string;
}

/** safeHandle resolves handler/validation failures to this envelope. */
export interface IpcFailure {
  success: false;
  error: string;
  [detail: string]: unknown;
}

export type IpcResult<T> = T | IpcFailure;

export interface ListFilesOptions {
  nonBlocking?: boolean;
  [option: string]: unknown;
}

export type DownloadProgressCallback = (
  progress: number,
  fileName: string,
  transferredBytes: number,
  totalBytes: number,
  transferSpeed: number,
  remainingTime: number,
  processedFiles: number,
  totalFiles: number,
  transferKey: string,
) => void;

export type UploadProgressCallback = (
  progress: number,
  fileName: string,
  transferredBytes: number,
  totalBytes: number,
  transferSpeed: number,
  remainingTime: number,
  currentFileIndex: number,
  processedFiles: number,
  totalFiles: number,
  transferKey: string,
  fileList: unknown[] | null,
) => void;

export type UploadFolderProgressCallback = (
  progress: number,
  fileName: string,
  currentFile: string,
  transferredBytes: number,
  totalBytes: number,
  transferSpeed: number,
  remainingTime: number,
  processedFiles: number,
  totalFiles: number,
  transferKey: string,
  fileList: unknown[] | null,
) => void;

export type UploadDroppedProgressCallback = (
  progress: number,
  fileName: string,
  transferredBytes: number,
  totalBytes: number,
  transferSpeed: number,
  remainingTime: number,
  currentFileIndex: number,
  processedFiles: number,
  totalFiles: number,
  transferKey: string,
  operationComplete: boolean,
  fileList: unknown[] | null,
) => void;
