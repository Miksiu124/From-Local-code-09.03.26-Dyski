"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Don't store raw error in production — it may contain sensitive info
    const sanitized =
      process.env.NODE_ENV === "production"
        ? new Error("An unexpected error occurred")
        : error;
    return { hasError: true, error: sanitized };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center gap-4 min-h-[200px]">
          <AlertTriangle className="h-10 w-10 text-destructive/60" />
          <div>
            <p className="font-medium text-sm">Something went wrong</p>
            <p className="text-xs text-muted-foreground mt-1">
              An unexpected error occurred while rendering this section.
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
