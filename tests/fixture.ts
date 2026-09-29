import {
  createObject,
  emptyDocument,
  stickyColors,
  type AxonDocument,
  type AxonObject,
  type Asset,
  type Connector,
  type ShapeKind,
} from "../src/model/document";
import { fitText } from "../src/rendering/text";
export function fixture(image?: Asset): AxonDocument {
  const doc = emptyDocument();
  doc.title = "Путь заказа";
  function shape(
    id: string,
    kind: ShapeKind,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fill = "#252F3C",
  ) {
    const o = createObject("shape", { x, y }, doc.background, kind);
    if (o.type !== "shape") throw Error();
    Object.assign(o, { id, w, h, text });
    o.style = { ...o.style, fill, stroke: "#72899F", strokeWidth: 1.5 };
    doc.objects.push(fitText(o));
    return o;
  }
  function text(
    id: string,
    x: number,
    y: number,
    value: string,
    size: number,
    color: string,
  ) {
    const o = createObject("text", { x, y }, doc.background);
    if (o.type !== "text") throw Error();
    Object.assign(o, { id, w: 900, h: 40, text: value });
    o.style = { ...o.style, fontSize: size, color };
    doc.objects.push(fitText(o));
  }
  function connect(
    id: string,
    a: AxonObject,
    b: AxonObject,
    label: string,
    start: Connector["start"] extends never
      ? never
      : "top" | "right" | "bottom" | "left" = "right",
    end: "top" | "right" | "bottom" | "left" = "left",
  ) {
    const o = createObject(
      "connector",
      { x: 0, y: 0 },
      doc.background,
    ) as Connector;
    Object.assign(o, {
      id,
      start: { type: "bound", nodeId: a.id, side: start },
      end: { type: "bound", nodeId: b.id, side: end },
      text: label,
    });
    o.style = { ...o.style, stroke: "#8FB7D5", color: "#C0D9EC", fontSize: 13 };
    doc.objects.unshift(o);
  }
  text("heading", 0, -120, "От запроса до результата", 32, "#E5EDF5");
  text("subtitle", 0, -70, "ПРОЦЕСС ОБРАБОТКИ ЗАКАЗА", 12, "#94A8BA");
  const client = shape(
    "client",
    "rect",
    0,
    0,
    195,
    104,
    "Клиент\nВеб-приложение",
  );
  const gateway = shape(
    "gateway",
    "rect",
    280,
    0,
    200,
    104,
    "API Gateway\nПроверка запроса",
    "#253849",
  );
  const decision = shape(
    "decision",
    "diamond",
    565,
    -20,
    220,
    154,
    "Заказ\nвалиден?",
  );
  const service = shape(
    "service",
    "rect",
    870,
    0,
    200,
    104,
    "Сервис заказов\nСоздать заказ",
    "#263B3C",
  );
  const database = shape(
    "database",
    "database",
    870,
    250,
    200,
    138,
    "PostgreSQL\norders",
  );
  const fail = shape(
    "failure",
    "callout",
    568,
    275,
    215,
    126,
    "Уточнить данные\nи повторить запрос",
    "#3E3034",
  );
  connect("api", client, gateway, "HTTPS");
  connect("validation", gateway, decision, "Проверка");
  connect("yes", decision, service, "Да");
  connect("sql", service, database, "SQL", "bottom", "top");
  connect("no", decision, fail, "Нет", "bottom", "top");
  const note = createObject("sticky", { x: 10, y: 235 }, doc.background);
  if (note.type === "sticky") {
    note.id = "note";
    note.w = 230;
    note.h = 190;
    note.text = "Не терять контекст\n\nПри ошибке сохраняем введённые данные.";
    note.style.fill = stickyColors[0];
    doc.objects.push(fitText(note));
  }
  const note2 = createObject("sticky", { x: 285, y: 260 }, doc.background);
  if (note2.type === "sticky") {
    note2.id = "note2";
    note2.w = 210;
    note2.h = 150;
    note2.text = "Следующий шаг\n\nПроверить таймауты API";
    note2.style.fill = stickyColors[2];
    doc.objects.push(fitText(note2));
  }
  const stroke = createObject("stroke", { x: 20, y: 450 }, doc.background);
  if (stroke.type === "stroke") {
    stroke.id = "sketch";
    stroke.style.stroke = "#9DCDBA";
    stroke.style.strokeWidth = 3;
    stroke.points = [
      { x: 0, y: 0 },
      { x: 25, y: 6 },
      { x: 65, y: 3 },
      { x: 105, y: -6 },
      { x: 145, y: -2 },
      { x: 185, y: 4 },
      { x: 220, y: -2 },
    ];
    doc.objects.push(stroke);
  }
  if (image) {
    doc.assets[image.id] = image;
    const o = createObject("image", { x: 0, y: 535 }, doc.background);
    if (o.type === "image") {
      o.id = "screenshot";
      o.assetId = image.id;
      o.w = 500;
      o.h = (500 * image.height) / image.width;
      doc.objects.push(o);
    }
    text(
      "image-caption",
      535,
      550,
      "Экран подтверждения\nПояснения к интерфейсу",
      20,
      "#B6C9DC",
    );
  }
  return doc;
}
