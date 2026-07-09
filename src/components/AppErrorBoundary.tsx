import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[xcoder] render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            height: "100%",
            padding: 24,
            overflow: "auto",
            background: "#1e1e1e",
            color: "#f48771",
            fontFamily: "Consolas, monospace",
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>界面渲染失败</strong>
          {"\n\n"}
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}
