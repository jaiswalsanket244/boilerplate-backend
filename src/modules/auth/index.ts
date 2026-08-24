import { Middleware } from "@/middleware/auth";
import { loginRateLimiter } from "@/middleware/rate-limiter";
import { AuthController } from "@/modules/auth/auth.controller";
import { authValidators } from "@/modules/auth/utils/auth.validation";
import { Router } from "express";

/**
 * Auth Router with dependency injection
 */
export class AuthRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new AuthController();

    this.router.post("/register", authValidators.register, controller.register);

    this.router.post(
      "/login",
      loginRateLimiter,
      authValidators.login,
      controller.login,
    );

    this.router.post("/logout", controller.logout);
    this.router.post("/refresh-token", controller.refreshToken);
    this.router.post("/revoke-token", controller.revokeToken);

    this.router.post(
      "/reset-password",
      authValidators.sendResetEmail,
      controller.sendResetEmail,
    );

    this.router.post(
      "/update-password",
      authValidators.updatePassword,
      controller.updatePassword,
    );

    this.router.put("/:id/unsubscribe", controller.unsubscribe);

    this.router.post(
      "/magic-link/request",
      authValidators.emailOnly,
      controller.requestMagicLink,
    );

    this.router.post(
      "/magic-link/verify",
      authValidators.verifyMagicLink,
      controller.verifyMagicLink,
    );

    this.router.post(
      "/invite/:token",
      authValidators.getEmailFromInviteToken,
      controller.getEmailFromInviteToken,
    );

    // OTP Routes
    this.router.post(
      "/request-otp",
      authValidators.requestOtp,
      controller.requestOtp,
    );

    this.router.post(
      "/resend-otp",
      authValidators.requestOtp,
      controller.resendOtp,
    );

    this.router.post(
      "/verify-otp",
      authValidators.verifyOtp,
      controller.verifyOtp,
    );

    // Oauth Routes
    this.router.post(
      "/social-signup",
      authValidators.registerLoginOauth,
      controller.registerLoginOauth,
    );

    this.router.get(
      "/url/oauth",
      authValidators.getOauthUrl,
      controller.getOauthUrl,
    );

    // MFA Routes
    this.router.use("/mfa", new MfaRouter().router);
  }
}

class MfaRouter {
  router: Router;

  constructor() {
    this.router = Router();

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new AuthController();
    const middleware = new Middleware();

    this.router.use(middleware.pendingMfaMiddleware);

    this.router.post("/setup/initiate", controller.initiateMfaSetup);
    this.router.post("/setup/verify", controller.verifyMfaSetup);
    this.router.post("/setup/skip", controller.skipMfaSetup);

    this.router.post("/verify", controller.verifyMfa);

    this.router.post("/recovery", controller.recoverMfa);

    this.router.post("/reset/email/otp", controller.sendResetMfaEmailOtp);
    this.router.post(
      "/reset/identity/verify",
      authValidators.verifyResetRequest,
      controller.verifyResetRequest,
    );

    this.router.post(
      "/recovery/reset",
      controller.updateSessionForRecoveryReconfiguration,
    );

    this.router.put("/disable", controller.disableMfa);
  }
}
