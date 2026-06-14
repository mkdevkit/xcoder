import type { ReactNode } from "react";
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

export function MarkdownContent({ content }: MarkdownContentProps) {
  const prepared = preprocessAssistantMarkdown(content);

  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {prepared}
      </ReactMarkdown>
      <style>{`
        .markdown-content {
          font-size: 13px;
          line-height: 1.6;
          word-break: break-word;
        }
        .markdown-content > :first-child {
          margin-top: 0;
        }
        .markdown-content > :last-child {
          margin-bottom: 0;
        }
        .markdown-content p,
        .markdown-content ul,
        .markdown-content ol,
        .markdown-content blockquote,
        .markdown-content pre,
        .markdown-content .md-code-block,
        .markdown-content .md-table-wrap {
          margin: 0 0 10px;
        }
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3,
        .markdown-content h4 {
          margin: 14px 0 8px;
          font-weight: 600;
          line-height: 1.35;
        }
        .markdown-content h1 { font-size: 1.35em; }
        .markdown-content h2 { font-size: 1.2em; }
        .markdown-content h3 { font-size: 1.08em; }
        .markdown-content h4 { font-size: 1em; }
        .markdown-content ul,
        .markdown-content ol {
          padding-left: 1.4em;
        }
        .markdown-content li + li {
          margin-top: 4px;
        }
        .markdown-content li > p {
          margin: 0;
        }
        .markdown-content blockquote {
          margin-left: 0;
          padding: 6px 10px;
          border-left: 3px solid rgba(0, 120, 212, 0.55);
          background: rgba(0, 120, 212, 0.08);
          color: var(--text-muted);
          border-radius: 0 4px 4px 0;
        }
        .markdown-content a {
          color: var(--accent-hover);
          text-decoration: none;
        }
        .markdown-content a:hover {
          text-decoration: underline;
        }
        .markdown-content .md-inline-code {
          font-family: var(--font-mono);
          font-size: 0.92em;
          background: rgba(0, 0, 0, 0.28);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
        }
        .markdown-content .md-code-block {
          border: 1px solid var(--border);
          border-radius: 6px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.24);
        }
        .markdown-content .md-code-lang {
          padding: 4px 10px;
          font-size: 11px;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          background: rgba(0, 0, 0, 0.18);
        }
        .markdown-content .md-code-block pre {
          margin: 0;
          padding: 10px 12px;
          overflow: auto;
        }
        .markdown-content .md-code-block code {
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.5;
          white-space: pre;
        }
        .markdown-content .md-table-wrap {
          overflow-x: auto;
        }
        .markdown-content table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .markdown-content th,
        .markdown-content td {
          border: 1px solid var(--border);
          padding: 6px 8px;
          text-align: left;
        }
        .markdown-content th {
          background: rgba(0, 0, 0, 0.2);
        }
        .markdown-content hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
}
