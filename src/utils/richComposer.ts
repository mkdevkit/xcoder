import { t } from "../i18n";
import { referenceDisplayName } from "./chatFileReference";

export const INLINE_FILE_REF_CLASS = "inline-file-ref";

export function createInlineFileRefElement(reference: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = INLINE_FILE_REF_CLASS;
  chip.contentEditable = "false";
  chip.dataset.ref = reference;
  chip.title = reference;

  const prefix = document.createElement("span");
  prefix.className = "inline-file-ref-prefix";
  prefix.textContent = "@";

  const label = document.createElement("span");
  label.className = "inline-file-ref-label";
  label.textContent = referenceDisplayName(reference);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "inline-file-ref-remove";
  remove.setAttribute(
    "aria-label",
    t("composer.removeRef", { name: referenceDisplayName(reference) }),
  );
  remove.textContent = "×";
  remove.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const editor = chip.parentElement;
    const sibling = chip.nextSibling;
    chip.remove();
    if (editor) {
      placeCursor(editor, sibling ?? null);
    }
  });

  chip.append(prefix, label, remove);
  return chip;
}

export function getInsertionRange(editor: HTMLElement): Range {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      return range;
    }
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

export function placeCursor(editor: HTMLElement, node: ChildNode | null) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  if (node) {
    range.setStartBefore(node);
  } else {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function insertInlineFileRefs(
  editor: HTMLElement,
  references: string[],
): boolean {
  if (references.length === 0) return false;

  const existing = new Set(
    Array.from(editor.querySelectorAll<HTMLElement>(`[data-ref]`))
      .map((node) => node.dataset.ref)
      .filter((value): value is string => Boolean(value)),
  );

  const range = getInsertionRange(editor);
  const selection = window.getSelection();
  let inserted = false;

  for (const reference of references) {
    if (existing.has(reference)) continue;
    existing.add(reference);

    const chip = createInlineFileRefElement(reference);
    range.insertNode(chip);

    const spacer = document.createTextNode(" ");
    range.setStartAfter(chip);
    range.collapse(true);
    range.insertNode(spacer);
    range.setStartAfter(spacer);
    range.collapse(true);
    inserted = true;
  }

  if (inserted && selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return inserted;
}

function normalizeSerializedMessage(text: string): string {
  return text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

export function serializeComposer(editor: HTMLElement): string {
  const chunks: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.length > 0) chunks.push(text);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    if (element.dataset.ref) {
      chunks.push(element.dataset.ref);
      return;
    }

    if (element.tagName === "BR") {
      chunks.push("\n");
      return;
    }

    for (const child of element.childNodes) {
      walk(child);
    }
  };

  for (const child of editor.childNodes) {
    walk(child);
  }

  return normalizeSerializedMessage(chunks.join(""));
}

export function isComposerEmpty(editor: HTMLElement): boolean {
  if (editor.querySelector(`[data-ref]`)) return false;
  const text = (editor.textContent ?? "").replace(/\u00A0/g, " ").trim();
  return text.length === 0;
}

export function clearComposer(editor: HTMLElement) {
  editor.innerHTML = "";
}
