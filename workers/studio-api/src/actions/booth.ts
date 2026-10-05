// Booth actions: a booth changed or built by name, by the assistant or any
// agent, with Booth Studio's own scene code (D-070, phase-5-booth.md 9b).
//
// studio-api never edits a Booth Studio scene itself. `../vendor/booth-scene.js`
// is the app's `npm run bundle:scene` build: it checks each op, applies it with
// the app's helpers and returns the scene through the app's validator, so an
// edit made here opens in Booth Studio exactly like one made in it.
import { Id, PLACEMENT_SCENE_MAX, newId } from "@studio/core";
import { z } from "zod";
import type { Db } from "../env";
import { HttpError } from "../lib/errors";
import * as Booth from "../vendor/booth-scene.js";
import { type ActionCtx, type Snapshot, defineAction } from "./runner";
import { checkVersion, getRecord, insertWrite, placementEntity, updateWrite } from "./records";

const APPS = ["booth-studio"] as const;
const one = (_c: ActionCtx, afters: (Snapshot | null)[]) => afters[0] as Snapshot;

/** An op list: the shape is checked here, each op by the app's code. */
const Ops = z.array(z.looseObject({ op: z.enum(Booth.OP_NAMES as [string, ...string[]]) })).min(1).max(Booth.MAX_OPS);

/** The app's refusal, as a 400 the assistant can read and correct. */
function sceneCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Booth.SceneOpError) {
      throw new HttpError("bad_request", err.message, err.index === null ? undefined : { op: err.index });
    }
    throw err;
  }
}

/** The scene, with the columns kept in step with it. Too big for a row → 400. */
function written(scene: Booth.BoothScene) {
  const size = JSON.stringify(scene).length;
  if (size > PLACEMENT_SCENE_MAX) {
    throw new HttpError("bad_request", `That would make the booth's scene ${size.toLocaleString("en-US")} characters; the studio keeps up to ${PLACEMENT_SCENE_MAX.toLocaleString("en-US")}.`);
  }
  const { name, width, depth, height, format, kind, sizeUnit } = Booth.fieldsOf(scene);
  return { scene, name, width, depth, height, format, kind, sizeUnit };
}

/** A placement Booth Studio wrote, or a 400 that says whose it is. */
async function boothOf(db: Db, studioId: string, id: string) {
  const rec = await getRecord(db, placementEntity, studioId, id);
  if (rec.format !== Booth.FORMAT) {
    throw new HttpError("bad_request", `That placement is in the format ${String(rec.format)}; booth edits work on ${Booth.FORMAT} scenes only.`);
  }
  return rec;
}
const imagesOf = (rec: Snapshot) => (Array.isArray(rec.images) ? (rec.images as Booth.BoothImage[]) : []);

/** The tool the model sees: an id, and the ops as the app describes them. */
const EDIT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "The booth's id (from search)" },
    version: { type: "integer", description: "Leave out: the current version is used" },
    ops: {
      type: "array",
      minItems: 1,
      maxItems: Booth.MAX_OPS,
      description: "Changes, applied in order; all of them or none. Ids and positions come from describe_booth.",
      items: { anyOf: Booth.OPS.map((o) => ({ ...o.schema, description: o.description })) },
    },
  },
  required: ["id", "ops"],
  additionalProperties: false,
};

export const placementEdit = defineAction({
  name: "placement.edit",
  description:
    "Change things inside a Booth Studio booth: its size, venue, canopy and wall colour; furniture; free-standing walls; where each work hangs. Call describe_booth first for the ids and positions (inches). The whole list is applied, or none of it.",
  input: z.object({ id: Id, version: z.number().int().min(1), ops: Ops }),
  toolSchema: EDIT_TOOL_SCHEMA,
  permission: "placements:write",
  risk: "confirm",
  apps: APPS,
  card: async (ctx, { id, ops }) => {
    const rec = await boothOf(ctx.db, ctx.actor.studioId, id);
    const { lines } = sceneCall(() => Booth.applyOps(rec.scene as Booth.BoothScene, ops as Booth.BoothOp[], imagesOf(rec)));
    return [{ label: "Booth", value: String(rec.name) }, ...lines.map((value, i) => ({ label: `Change ${i + 1}`, value }))];
  },
  plan: async (ctx, { id, version, ops }) => {
    const before = await boothOf(ctx.db, ctx.actor.studioId, id);
    checkVersion(before, version);
    const { scene } = sceneCall(() => Booth.applyOps(before.scene as Booth.BoothScene, ops as Booth.BoothOp[], imagesOf(before)));
    return { writes: [updateWrite(ctx, placementEntity, before, written(scene))] };
  },
  respond: one,
});

const BuildInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  show: z.string().optional(),
  size: z.string().optional(),
  ops: Ops.optional(),
});

export const placementBuild = defineAction({
  name: "placement.build",
  description:
    "Make a new Booth Studio booth: a standard booth for a kind of show and footprint, then any ops (as for placement_edit) to size and furnish it. It appears in the artist's list of booths, ready to open.",
  input: BuildInput,
  toolSchema: { ...Booth.BUILD_SCHEMA, properties: { ...(Booth.BUILD_SCHEMA.properties as Snapshot), ops: (EDIT_TOOL_SCHEMA.properties as Snapshot).ops } },
  permission: "placements:write",
  risk: "confirm",
  apps: APPS,
  card: async (_ctx, spec) => {
    const { lines } = sceneCall(() => Booth.build(spec as Parameters<typeof Booth.build>[0]));
    return lines.map((value, i) => ({ label: i ? `Change ${i}` : "Booth", value }));
  },
  plan: async (ctx, spec) => {
    const { scene } = sceneCall(() => Booth.build(spec as Parameters<typeof Booth.build>[0]));
    const fields = written(scene);
    return {
      writes: [insertWrite(ctx, placementEntity, { ...fields, id: newId(), images: [], meta: { projectId: scene.id } })],
    };
  },
  respond: one,
});

/** What is in a booth, for a model: ids and positions, never the images (GET /placements/{id}/summary). */
export async function boothSummary(db: Db, studioId: string, id: string) {
  const rec = await boothOf(db, studioId, id);
  return {
    id: rec.id as string,
    version: rec.version as number,
    ...Booth.describe(rec.scene as Booth.BoothScene, imagesOf(rec)),
  };
}
