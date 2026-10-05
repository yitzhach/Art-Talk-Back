// Types for booth-scene.js, Booth Studio's scene logic as studio-api runs it
// (D-070). The JavaScript is generated in yitzhach/booth-studio by
// `npm run bundle:scene` from src/scene-ops.js and copied here unchanged; CI
// in both repos fails when the copy is out of date. This file is written by
// hand and lists only what studio-api uses.

export type BoothScene = Record<string, unknown>;
export interface BoothImage {
  key: string;
  fileId: string | null;
  name?: string | null;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  role?: string | null;
}
export type BoothOp = { op: string } & Record<string, unknown>;
export interface OpDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}
export interface Applied {
  scene: BoothScene;
  lines: string[];
}
export interface BoothFields {
  kind: "booth";
  name: string;
  format: string;
  width: number | null;
  depth: number | null;
  height: number | null;
  sizeUnit: "in";
}

export const FORMAT: string;
export const SCENE_OPS_VERSION: number;
export const MAX_OPS: number;
export const OPS: OpDef[];
export const OP_NAMES: string[];
export const BUILD_SCHEMA: Record<string, unknown>;
export class SceneOpError extends Error {
  index: number | null;
  constructor(message: string, index?: number | null);
}
export function describe(scene: BoothScene, images?: BoothImage[]): Record<string, unknown>;
export function applyOps(scene: BoothScene, ops: BoothOp[], images?: BoothImage[]): Applied;
export function build(spec?: { name?: string; show?: string; size?: string; ops?: BoothOp[] }): Applied;
export function fieldsOf(scene: BoothScene): BoothFields;
export function inches(n: number): string;
