import {
  OrderDiscountSelectionStrategy,
  ProductDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";

export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    throw new Error("No cart lines found");
  }

  const { variantDiscounts } = parseMetafield(
    input.discount.metafield,
  );

  const operations = [];

  // Group lines by percentage
  const linesByPercentage = new Map();

  input.cart.lines.forEach((line) => {
    if (line.merchandise.__typename === "ProductVariant") {
      const variantId = line.merchandise.id;
      const percentage = variantDiscounts[variantId];

      if (percentage && percentage > 0) {
        if (!linesByPercentage.has(percentage)) {
          linesByPercentage.set(percentage, []);
        }
        linesByPercentage.get(percentage).push(line.id);
      }
    }
  });

  const candidates = [];

  // Create candidates for each percentage group
  for (const [percentage, lineIds] of linesByPercentage.entries()) {
    candidates.push({
      message: `${percentage}% OFF`,
      targets: lineIds.map((id) => ({
        cartLine: {
          id: id,
        },
      })),
      value: {
        percentage: {
          value: percentage,
        },
      },
    });
  }

  if (candidates.length === 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

function parseMetafield(metafield) {
  try {
    const value = JSON.parse(metafield.value);
    return {
      variantDiscounts: value.variantDiscounts || {},
    };
  } catch (error) {
    console.error("Error parsing metafield", error);
    return {
      variantDiscounts: {},
    };
  }
}