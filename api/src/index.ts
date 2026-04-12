import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config";
import { errorMessage, isApiError } from "./errors";
import { blobsRouter } from "./routes/blobs";
import { eventsRouter } from "./routes/events";

const app = express();

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "nostrmesh-api",
    relayUrls: config.relayUrls,
    blossomUrl: config.blossomUrl,
  });
});

app.use("/blobs", blobsRouter);
app.use("/events", eventsRouter);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isApiError(error)) {
    res.status(error.status).json({
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return;
  }
  if (error instanceof Error) {
    res.status(500).json({
      error: error.message,
      code: "internal_error",
    });
    return;
  }
  res.status(500).json({
    error: errorMessage(error),
    code: "internal_error",
  });
});

app.listen(config.port, () => {
  console.log(`nostrmesh-api listening on http://localhost:${config.port}`);
});
