import { randomUUID } from "crypto";
import { Router } from "express";
import { authRequired } from "../middleware/auth.js";

const r = Router();
r.use(authRequired);

const tasks = [];

r.get("/", (_req, res) => {
  res.json({ tasks });
});

r.post("/", (req, res) => {
  const { title } = req.body || {};
  const t = {
    id: randomUUID(),
    title: title || "New task",
    column: "todo",
  };
  tasks.push(t);
  res.status(201).json({ task: t });
});

export default r;
