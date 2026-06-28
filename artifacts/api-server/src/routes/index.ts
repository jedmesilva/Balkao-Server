import { Router, type IRouter } from "express";
import healthRouter from "./health";
import whatsappRouter from "./whatsapp";
import pluggyRouter from "./pluggy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(whatsappRouter);
router.use(pluggyRouter);

export default router;
