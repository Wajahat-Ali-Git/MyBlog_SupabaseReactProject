import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Box, Button, Typography } from "@mui/material";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            p: 4,
            textAlign: "center",
          }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: "1.25rem", color: "#0f172a" }}>
            Something went wrong.
          </Typography>
          <Typography sx={{ color: "#64748b", maxWidth: 480 }}>
            {this.state.error.message}
          </Typography>
          <Button variant="contained" onClick={() => (window.location.href = "/")}>
            Go home
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}
