import { memo, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "../utils/tauri";
import { preprocessAssistantMarkdown } from "../utils/markdownPreprocess";

interface MarkdownContentProps {
  content: string;
}

async function openExternalLink(href: string) {
  if (!isTauri()) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await openUrl(href);
  } catch (error) {
    console.error("Failed to open URL:", error);
  }
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const match = /language-([\w+-]+)/.exec(className ?? "");
  const language = match?.[1];
  const code = String(children ?? "").replace(/\n$/, "");
  const showLang = language && language !== "text";

  return (
    <div className="md-code-block">
      {showLang && <div className="md-code-lang">{language}</div>}
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  a({ href, children }) {
    if (!href) return <span>{children}</span>;
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          void openExternalLink(href);
        }}
      >
        {children}
      </a>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    if (className?.startsWith("language-")) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return <code className="md-inline-code">{children}</code>;
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

function MarkdownContentInner({ content }: MarkdownContentProps) {
  const prepared = preprocessAssistantMarkdown(content);

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownContent = memo(
  MarkdownContentInner,
  (prev, next) => prev.content === next.content,
);
