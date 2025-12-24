import {
  DiscountClass,
  OrderDiscountSelectionStrategy,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

const TARGET_PRODUCT_ID = "gid://shopify/Product/8275336495291";

/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {

  
  const operations = [];

  console.log("cart_lines_discounts_generate_run==================");
  if (!input.cart.lines.length) {
    return {operations: []};
  }

  const percentage = input.discount.configuration?.percentage ?? 20;

  if (percentage <= 0) {
    return { operations };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );
  if (!hasProductDiscountClass) {
    return { operations };
  }


  console.log("Cart Lines:", input.cart.lines);
  const matchingLines = input.cart.lines.filter((line) => {
    const merchandise = line.merchandise;
    if (!merchandise) {
      return false;
    }

    console.log("Merchandise Product ID:", merchandise.product.id);
    return merchandise.product.id === TARGET_PRODUCT_ID;
  });

  console.log(matchingLines.length);
  // console.log("Matching Lines:", matchingLines);

  if (!matchingLines.length) {
    return { operations };
  }

  if (hasProductDiscountClass) {
    operations.push({
      productDiscountsAdd: {
        candidates: [
          {
            message: '20% OFF PRODUCT',
            targets: matchingLines.map((line) => ({
              cartLine: {
                id: line.id,
              },
            })),
            value: {
              percentage: {
                value: percentage,
              },
            },
          },
        ],
        selectionStrategy: ProductDiscountSelectionStrategy.First,
      },
    });
  }

  return {
    operations,
  };
}