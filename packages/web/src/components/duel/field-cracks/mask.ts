/* The mat mask of a field: opaque everywhere except the chunks that have broken off.
   Several crack layers (the two halves of a 1v1 mat) can share one face: each owns a mask layer and the layers
   intersect, so the holes of all of them show. Set through the style attribute, so React never fights over it. */

const masks = new WeakMap<HTMLElement, Map<string, string>>();

const PROPS = ["mask-image", "mask-size", "mask-position", "mask-repeat", "mask-composite"] as const;

function apply(face: HTMLElement, layers: Map<string, string>) {
  const urls = [...layers.values()];
  const style = face.style;
  if (urls.length === 0) {
    for (const name of PROPS) {
      style.removeProperty(name);
      style.removeProperty(`-webkit-${name}`);
    }
    return;
  }
  const same = (value: string) => urls.map(() => value).join(", ");
  const values: Record<(typeof PROPS)[number], string> = {
    "mask-image": urls.join(", "),
    // The svg spans the element box plus 1.5 boxes of slack on every side, so shadows and glows outside the mat keep drawing.
    "mask-size": same("400% 400%"),
    "mask-position": same("50% 50%"),
    "mask-repeat": same("no-repeat"),
    "mask-composite": same("intersect"),
  };
  for (const name of PROPS) {
    style.setProperty(name, values[name]);
    style.setProperty(`-webkit-${name}`, name === "mask-composite" ? same("source-in") : values[name]);
  }
}

/** Sets (or, with null, removes) the mask layer `id` of `face`. */
export function setFaceMask(face: HTMLElement, id: string, url: string | null | undefined) {
  let layers = masks.get(face);
  if (!layers) {
    if (!url) return;
    layers = new Map();
    masks.set(face, layers);
  }
  if (url) layers.set(id, url);
  else layers.delete(id);
  apply(face, layers);
  if (layers.size === 0) masks.delete(face);
}
