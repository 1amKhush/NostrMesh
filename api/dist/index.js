"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const blobs_1 = require("./routes/blobs");
const events_1 = require("./routes/events");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "2mb" }));
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "nostrmesh-api",
        relayUrls: config_1.config.relayUrls,
        blossomUrl: config_1.config.blossomUrl,
        blossomPublicUrl: config_1.config.blossomPublicUrl,
    });
});
app.use("/blobs", blobs_1.blobsRouter);
app.use("/events", events_1.eventsRouter);
app.use((error, _req, res, _next) => {
    if (error instanceof Error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.status(500).json({ error: "Unknown error" });
});
app.listen(config_1.config.port, () => {
    console.log(`nostrmesh-api listening on http://localhost:${config_1.config.port}`);
});
