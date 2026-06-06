import { Router } from "express";
import { Server } from "socket.io";

export function createStatsRouter(io: Server) {
  const router = Router();

  router.get("/stats", (req, res) => {
    res.json({
      online: io.engine.clientsCount,
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version || "1.0.0",
    });
  });

  return router;
}
