import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config";
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
    blossomPublicUrl: config.blossomPublicUrl,
  });
});

app.use("/blobs", blobsRouter);
app.use("/events", eventsRouter);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof Error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "Unknown error" });
});

app.listen(config.port, () => {
  console.log(`nostrmesh-api listening on http://localhost:${config.port}`);
});
