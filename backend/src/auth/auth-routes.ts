import { Router } from "express";
import { loginHandler, logoutHandler, meHandler, registerHandler } from "./auth-controller.js";
import { requireAuth } from "./auth-middleware.js";
import { loginRateLimit } from "./login-rate-limit.js";

const router = Router();

router.post("/register", registerHandler);
router.post("/login", loginRateLimit, loginHandler);
router.post("/logout", logoutHandler);
router.get("/me", requireAuth, meHandler);

export default router;
