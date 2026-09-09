import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import projectsRouter from "./projects.js";
import importGithubRouter from "./import-github.js";
import filesRouter from "./files.js";
import execRouter from "./exec.js";
import aiRouter from "./ai.js";
import githubRouter from "./github.js";
import settingsRouter from "./settings.js";
import previewRouter from "./preview.js";
import devServerRouter from "./dev-server.js";
import playgroundRouter from "./playground.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(importGithubRouter);
router.use(projectsRouter);
router.use(filesRouter);
router.use(execRouter);
router.use(aiRouter);
router.use(githubRouter);
router.use(settingsRouter);
router.use(previewRouter);
router.use(devServerRouter);
router.use(playgroundRouter);

export default router;
