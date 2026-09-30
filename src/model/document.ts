import { z } from "zod";

const coordinate = z.number().finite().min(-1e6).max(1e6);
const dimension = z.number().finite().min(1).max(100000);
const id = z.string().min(1).max(100);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const markerSchema = z.enum(["none", "arrow", "open", "triangle", "circle", "diamond"]);
export type Marker = z.infer<typeof markerSchema>;
export const pointSchema = z.object({ x: coordinate, y: coordinate }).strict();
export const styleSchema = z
  .object({
    fill: z.union([colorSchema, z.literal("none")]),
    stroke: colorSchema,
    strokeWidth: z.number().min(0).max(24),
    dash: z.boolean(),
    radius: z.number().min(0).max(64),
    color: colorSchema,
    fontSize: z.number().finite().min(1).max(1200),
    padding: z.number().finite().min(0).max(10000).optional(),
    font: z.enum(["sans", "mono"]),
    align: z.enum(["left", "center", "right"]),
  })
  .strict();
const base = {
  id,
  x: coordinate,
  y: coordinate,
  w: dimension,
  h: dimension,
  locked: z.boolean(),
  groupId: id.optional(),
  style: styleSchema,
};
const text = z.string().max(20000);
export const endpointSchema = z.union([
  z.object({ type: z.literal("free"), x: coordinate, y: coordinate }).strict(),
  z
    .object({
      type: z.literal("bound"),
      nodeId: id,
      side: z.enum(["top", "right", "bottom", "left"]),
    })
    .strict(),
]);
export const objectSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...base,
      type: z.literal("shape"),
      shape: z.enum([
        "rect",
        "ellipse",
        "diamond",
        "triangle",
        "database",
        "callout",
      ]),
      mind: z
        .object({
          treeId: id,
          parentId: id.nullable(),
          order: z.number().int().nonnegative(),
          side: z.enum(["left", "right"]).optional(),
          presentation: z.literal("text").optional(),
        })
        .strict()
        .optional(),
      text,
    })
    .strict(),
  z.object({ ...base, type: z.literal("sticky"), text }).strict(),
  z.object({ ...base, type: z.literal("text"), text }).strict(),
  z.object({ ...base, type: z.literal("image"), assetId: id }).strict(),
  z
    .object({
      ...base,
      type: z.literal("stroke"),
      points: z.array(pointSchema).min(1).max(50000),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("connector"),
      start: endpointSchema,
      end: endpointSchema,
      route: z.enum(["straight", "orthogonal", "curved"]),
      mindBranch: id.optional(),
      arrows: z.enum(["none", "end", "both"]),
      startMarker: markerSchema.optional(),
      endMarker: markerSchema.optional(),
      text,
    })
    .strict(),
]);
export const assetSchema = z
  .object({
    id,
    mime: z.enum(["image/png", "image/jpeg"]),
    data: z
      .string()
      .max(28e6)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  })
  .strict();
export const documentSchema = z
  .object({
    format: z.literal("axon"),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    id,
    title: z.string().min(1).max(200),
    background: colorSchema,
    objects: z.array(objectSchema).max(10000),
    assets: z.record(z.string(), assetSchema),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    const nodes = new Map(doc.objects.map((o) => [o.id, o]));
    const groups = new Map<string, boolean>();
    for (const o of doc.objects) {
      if (o.type === "shape" && o.mind) {
        if (doc.version < 3 && (o.mind.side || o.mind.presentation))
          ctx.addIssue({
            code: "custom",
            message: "Текстовые темы требуют формат версии 3",
          });
        const directParent = o.mind.parentId
          ? nodes.get(o.mind.parentId)
          : undefined;
        if (
          o.mind.presentation === "text" &&
          (!o.mind.side ||
            (directParent?.type === "shape" &&
              directParent.mind?.parentId &&
              directParent.mind.side &&
              directParent.mind.side !== o.mind.side))
        )
          ctx.addIssue({
            code: "custom",
            message: "Несогласованное направление ветви mind map",
          });
        const seen = new Set([o.id]);
        let current = o;
        while (current.mind?.parentId) {
          const parent = nodes.get(current.mind.parentId);
          if (
            !parent ||
            parent.type !== "shape" ||
            !parent.mind ||
            parent.mind.treeId !== o.mind.treeId ||
            seen.has(parent.id)
          ) {
            ctx.addIssue({
              code: "custom",
              message: "Повреждённая структура mind map",
            });
            break;
          }
          seen.add(parent.id);
          current = parent;
        }
        if (current.mind?.parentId === null && current.id !== o.mind.treeId)
          ctx.addIssue({
            code: "custom",
            message: "Недопустимый корень mind map",
          });
        const branches = doc.objects.filter(
          (c) => c.type === "connector" && c.mindBranch === o.id,
        );
        if (branches.length !== (o.mind.parentId ? 1 : 0))
          ctx.addIssue({
            code: "custom",
            message: "Отсутствует или повторяется ветвь mind map",
          });
      }
      if (o.type === "connector" && o.mindBranch) {
        const child = nodes.get(o.mindBranch);
        if (
          !child ||
          child.type !== "shape" ||
          !child.mind?.parentId ||
          o.start.type !== "bound" ||
          o.end.type !== "bound" ||
          o.start.nodeId !== child.mind.parentId ||
          o.end.nodeId !== child.id
        )
          ctx.addIssue({
            code: "custom",
            message: "Недопустимая структурная связь",
          });
      }
      if (ids.has(o.id))
        ctx.addIssue({ code: "custom", message: "Повторяющийся ID" });
      ids.add(o.id);
      if (o.groupId) {
        if (groups.has(o.groupId) && groups.get(o.groupId) !== o.locked)
          ctx.addIssue({
            code: "custom",
            message: "Несогласованная блокировка группы",
          });
        groups.set(o.groupId, o.locked);
      }
      if (o.type === "image" && !doc.assets[o.assetId])
        ctx.addIssue({ code: "custom", message: "Изображение отсутствует" });
      if (o.type === "connector")
        for (const e of [o.start, o.end])
          if (e.type === "bound") {
            const node = nodes.get(e.nodeId);
            if (!node || !["shape", "sticky"].includes(node.type))
              ctx.addIssue({
                code: "custom",
                message: "Недопустимая привязка",
              });
          }
    }
    for (const [key, asset] of Object.entries(doc.assets)) {
      if (
        key !== asset.id ||
        !(asset.mime === "image/png"
          ? asset.data.startsWith("iVBORw0KGgo")
          : asset.data.startsWith("/9j/"))
      )
        ctx.addIssue({ code: "custom", message: "Недопустимое изображение" });
    }
  });

export type Point = z.infer<typeof pointSchema>;
export type Style = z.infer<typeof styleSchema>;
export type AxonObject = z.infer<typeof objectSchema>;
export type ShapeKind = Extract<AxonObject, { type: "shape" }>["shape"];
export type Endpoint = z.infer<typeof endpointSchema>;
export type Connector = Extract<AxonObject, { type: "connector" }>;
/** Missing fields retain the exact legacy appearance; loading does not rewrite data. */
export function connectorMarkers(c: Pick<Connector, "arrows" | "startMarker" | "endMarker">): { start: Marker; end: Marker } {
  return { start: c.startMarker ?? (c.arrows === "both" ? "arrow" : "none"), end: c.endMarker ?? (c.arrows === "none" ? "none" : "arrow") };
}
export type Asset = z.infer<typeof assetSchema>;
export type AxonDocument = z.infer<typeof documentSchema>;
export type Bounds = { x: number; y: number; w: number; h: number };
export const uid = () => crypto.randomUUID();
export const SHAPE_STROKE_WIDTH = 1.5;
export const CONNECTOR_STROKE_WIDTH = 2;
export const stickyColors = [
  "#F1D58A",
  "#B7DAB7",
  "#AACFEA",
  "#EDB2AE",
  "#CEBCEB",
  "#CDD1D5",
];
export function isLight(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 > 155;
}
export function defaultStyle(background = "#181C22"): Style {
  const light = isLight(background);
  return {
    fill: light ? "#FFFFFF" : "#252D38",
    stroke: light ? "#596A7B" : "#8CACC5",
    strokeWidth: SHAPE_STROKE_WIDTH,
    dash: false,
    radius: 12,
    color: light ? "#202B38" : "#EDF3F9",
    fontSize: 16,
    font: "sans",
    align: "center",
  };
}
export function emptyDocument(): AxonDocument {
  return {
    format: "axon",
    version: 3,
    id: uid(),
    title: "Без названия",
    background: "#181C22",
    objects: [],
    assets: {},
  };
}
export function createObject(
  type: AxonObject["type"],
  p: Point,
  background: string,
  shape: ShapeKind = "rect",
): AxonObject {
  const b = {
    id: uid(),
    x: p.x,
    y: p.y,
    w: 180,
    h: 100,
    locked: false,
    style: defaultStyle(background),
  };
  switch (type) {
    case "shape":
      return { ...b, type, shape, text: "" };
    case "sticky":
      return {
        ...b,
        type,
        w: 200,
        h: 180,
        text: "",
        style: {
          ...b.style,
          fill: stickyColors[0],
          stroke: stickyColors[0],
          color: "#29251C",
          align: "left",
          strokeWidth: 0,
          radius: 3,
        },
      };
    case "text":
      return {
        ...b,
        type,
        w: 240,
        h: 40,
        text: "",
        style: { ...b.style, fill: "none", strokeWidth: 0, align: "left" },
      };
    case "connector":
      return {
        ...b,
        type,
        start: { type: "free", ...p },
        end: { type: "free", x: p.x + 180, y: p.y },
        route: "orthogonal",
        arrows: "end",
        text: "",
        style: {
          ...b.style,
          fill: "none",
          strokeWidth: CONNECTOR_STROKE_WIDTH,
        },
      };
    case "stroke":
      return {
        ...b,
        type,
        w: 1,
        h: 1,
        points: [{ x: 0, y: 0 }],
        style: { ...b.style, fill: "none", strokeWidth: 2.5 },
      };
    case "image":
      return { ...b, type, assetId: "" };
  }
}
export function parseDocument(value: unknown): AxonDocument {
  if (typeof value === "string" && value.length > 80e6)
    throw new Error("Файл больше 80 МБ.");
  let json: unknown;
  try {
    json = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error("Файл повреждён: не удалось прочитать JSON.");
  }
  if (
    json &&
    typeof json === "object" &&
    "version" in json &&
    json.version !== 1 &&
    json.version !== 2 &&
    json.version !== 3
  )
    throw new Error("Эта версия формата Axon пока не поддерживается.");
  const result = documentSchema.safeParse(json);
  if (!result.success)
    throw new Error(
      "Файл не соответствует формату Axon: " + result.error.issues[0].message,
    );
  return result.data;
}
export function serializeDocument(doc: AxonDocument) {
  return JSON.stringify(parseDocument(doc));
}
export function isTextTopic(
  o: AxonObject,
): o is Extract<AxonObject, { type: "shape" }> & {
  mind: NonNullable<Extract<AxonObject, { type: "shape" }>["mind"]> & {
    presentation: "text";
  };
} {
  return o.type === "shape" && o.mind?.presentation === "text";
}
export function pruneAssets(doc: AxonDocument): AxonDocument {
  const used = new Set(
    doc.objects.filter((o) => o.type === "image").map((o) => o.assetId),
  );
  return {
    ...doc,
    assets: Object.fromEntries(
      Object.entries(doc.assets).filter(([key]) => used.has(key)),
    ),
  };
}
