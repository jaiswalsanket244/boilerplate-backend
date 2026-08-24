import { IUserWithCompany } from "../../src/modules/users/utils/users.types";

declare global {
  namespace Express {
    interface Request {
      user?: IUserWithCompany;
      isMobile?: boolean;
    }
  }
}

export {};
