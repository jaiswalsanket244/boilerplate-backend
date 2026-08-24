import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const SetDefaultCardBodySchema = z.object({
  paymentMethodId: z.string().optional(),
});

// ==================== Validators ====================

const setDefaultCardValidator = validate(
  { body: SetDefaultCardBodySchema },
  validationErrorHandler,
);

const emptyValidator = validate({}, validationErrorHandler);

export const cardValidators = {
  setDefaultCard: setDefaultCardValidator,
  listCards: emptyValidator,
  addCard: emptyValidator,
};
