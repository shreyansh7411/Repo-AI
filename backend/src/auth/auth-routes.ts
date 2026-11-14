import { Router } from "express";
import { changePasswordHandler, loginHandler, logoutHandler, meHandler, registerHandler, updateProfileHandler } from "./auth-controller.js";
import { requireAuth } from "./auth-middleware.js";
import { loginRateLimit } from "./login-rate-limit.js";

const router = Router();

router.post("/register", registerHandler);
router.post("/login", loginRateLimit, loginHandler);
router.post("/logout", logoutHandler);
router.get("/me", requireAuth, meHandler);
router.patch("/profile", requireAuth, updateProfileHandler);
router.post("/password", requireAuth, changePasswordHandler);

export default router;
