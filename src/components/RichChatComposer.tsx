import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  clearComposer,
  insertInlineFileRefs,
  isComposerEmpty,
  serializeComposer,
} from "../utils/richComposer";

export interface RichChatComposerHandle {
  insertReferences: (references: string[]) => void;
  clear: () => void;
  getMessage: () => string;
  isEmpty: () => boolean;
  focus: () => void;
}

interface RichChatComposerProps {
  placeholder: string;
  editable: boolean;
  onContentChange?: () => void;
  onEnter?: () => void;
  onDragEnter?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDragLeave?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
}

export const RichChatComposer = forwardRef<
  RichChatComposerHandle,
  RichChatComposerProps
>(function RichChatComposer(
  {
    placeholder,
    editable,
    onContentChange,
    onEnter,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(true);

  const syncPlaceholder = () => {
    const editor = editorRef.current;
    if (!editor) return;
    setShowPlaceholder(isComposerEmpty(editor));
    onContentChange?.();
  };

  useImperativeHandle(ref, () => ({
    insertReferences: (references) => {
      const editor = editorRef.current;
      if (!editor || references.length === 0) return;
      editor.focus();
      insertInlineFileRefs(editor, references);
      syncPlaceholder();
    },
    clear: () => {
      const editor = editorRef.current;
      if (!editor) return;
      clearComposer(editor);
      syncPlaceholder();
    },
    getMessage: () => {
      const editor = editorRef.current;
      return editor ? serializeComposer(editor) : "";
    },
    isEmpty: () => {
      const editor = editorRef.current;
      return editor ? isComposerEmpty(editor) : true;
    },
    focus: () => {
      editorRef.current?.focus();
    },
  }));

  useEffect(() => {
    syncPlaceholder();
  }, [placeholder, editable]);

  const handleInput = () => {
    syncPlaceholder();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
    syncPlaceholder();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onEnter?.();
    }
  };

  return (
    <div className="rich-chat-composer-wrap">
      {showPlaceholder && (
        <div className="rich-chat-composer-placeholder">{placeholder}</div>
      )}
      <div
        ref={editorRef}
        className="rich-chat-composer"
        contentEditable={editable}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />
      <style>{`
        .rich-chat-composer-wrap {
          position: relative;
          width: 100%;
        }
        .rich-chat-composer-placeholder {
          position: absolute;
          inset: 0;
          padding: 8px 10px;
          color: var(--text-muted);
          font: inherit;
          line-height: 1.6;
          pointer-events: none;
          white-space: pre-wrap;
        }
        .rich-chat-composer {
          width: 100%;
          min-height: 88px;
          max-height: 220px;
          overflow: auto;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-base);
          color: var(--text);
          font: inherit;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          outline: none;
          cursor: text;
        }
        .rich-chat-composer:focus {
          border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
        }
        .rich-chat-composer[contenteditable="false"] {
          opacity: 0.72;
          cursor: default;
        }
        .inline-file-ref {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: min(240px, 100%);
          margin: 0 1px;
          padding: 1px 6px 1px 8px;
          border-radius: 6px;
          vertical-align: baseline;
          background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
          border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
          color: var(--text);
          font-size: 12px;
          line-height: 1.5;
          user-select: none;
        }
        .inline-file-ref-prefix {
          color: var(--accent);
          font-weight: 600;
        }
        .inline-file-ref-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .inline-file-ref-remove {
          width: 18px;
          height: 18px;
          padding: 0;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
        }
        .inline-file-ref-remove:hover {
          background: var(--bg-hover);
          color: var(--text);
        }
      `}</style>
    </div>
  );
});
