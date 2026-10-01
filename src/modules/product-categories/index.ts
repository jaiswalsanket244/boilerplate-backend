import { Middleware } from "@/middleware/auth";
import { ProductCategoryAdminController } from "@/modules/product-categories/product-category-admin.controller";
import { productCategoryValidators } from "@/modules/product-categories/utils/product-category.validation";
import { Router } from "express";
import { authorize } from "@/middleware/authorize";
import { PERMISSIONS } from "@/enums";

const middleware = new Middleware();

export class AdminProductCategoriesRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const adminController = new ProductCategoryAdminController();

    this.router
      .get(
        "/",
        authorize(PERMISSIONS.PRODUCTS_VIEW),
        productCategoryValidators.getProductCategories,
        adminController.get,
      )
      .post(
        "/",
        authorize(PERMISSIONS.PRODUCTS_WRITE),
        productCategoryValidators.createProductCategory,
        adminController.create,
      );
    this.router
      .put(
        "/:id",
        authorize(PERMISSIONS.PRODUCTS_WRITE),
        productCategoryValidators.updateProductCategory,
        adminController.update,
      )
      .delete(
        "/:id",
        authorize(PERMISSIONS.PRODUCTS_MANAGE),
        productCategoryValidators.deleteProductCategory,
        adminController.delete,
      );
  }
}
