import { validationErrorHandler } from "@/helpers/validation-error";
import z from "zod";
import { validate } from "zod-express-validator";

// ==================== Schemas ====================

export const SetDefaultCardBodySchema = z.object({
  paymentMethodId: z.string().optional(),
});

export const RemoveCardParamsSchema = z.object({
  paymentMethodId: z.string().min(1, "Payment method ID is required"),
});

// ==================== Validators ====================

const setDefaultCardValidator = validate(
  { body: SetDefaultCardBodySchema },
  validationErrorHandler,
);

const removeCardValidator = validate(
  { params: RemoveCardParamsSchema },
  validationErrorHandler,
);

const emptyValidator = validate({}, validationErrorHandler);

export const cardValidators = {
  setDefaultCard: setDefaultCardValidator,
  listCards: emptyValidator,
  addCard: emptyValidator,
  removeCard: removeCardValidator,
};
